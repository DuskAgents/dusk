// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DUSK Vault (V5)
/// @notice Spending limits for AI agents, enforced on-chain.
///         An owner locks tokens in a vault and names an agent wallet.
///         The agent can pay sellers only inside the limits the owner set:
///         per payment, per day, per seller per day, total balance and expiry.
///         Above an optional threshold, a payment waits for the owner's approval.
///         Kill switch: one call freezes every vault of an owner at once, and nothing can be paid until they unfreeze.
///         No admin, no upgrade, no override. Nobody but the owner can move a vault's funds
///         outside these rules, and nobody can raise its limits but the owner.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

contract DuskVault {
    struct Vault {
        address owner;
        address agent;
        address token;
        uint256 balance;     // tokens held for this vault
        uint256 spent;       // total paid to sellers
        uint256 perCall;     // max per payment
        uint256 daily;       // max per UTC day
        uint256 sellerDaily; // max per seller per UTC day, 0 = no cap
        uint256 askAbove;    // above this, the owner approves first, 0 = never
        uint256 expires;     // unix time
        uint256 day;         // current UTC day index
        uint256 daySpent;    // spent during `day`
        uint256 payments;    // number of payments made
        bool paused;
        bool closed;
    }

    struct Request {
        uint256 vault;
        address seller;
        uint256 amount;
        bytes32 memo;
        uint256 expires;
        uint8 status; // 1 waiting, 2 approved, 3 declined
    }

    uint256 public constant REQUEST_TTL = 1 days;

    mapping(uint256 => Vault) private _vaults;
    mapping(uint256 => Request) private _requests;
    mapping(address => uint256[]) private _owned;
    mapping(uint256 => uint256[]) private _vaultRequests;
    mapping(uint256 => mapping(address => uint256)) private _sellerDay;   // vault => seller => day index
    mapping(uint256 => mapping(address => uint256)) private _sellerSpent; // vault => seller => spent that day
    uint256 public vaultCount;
    uint256 public requestCount;
    uint256 private _lock = 1;
    /// @notice Owner kill switch. While true, no vault of this owner can pay or approve.
    mapping(address => bool) public frozen;

    event Opened(uint256 indexed vault, address indexed owner, address indexed agent, address token, uint256 deposit, uint256 perCall, uint256 daily, uint256 sellerDaily, uint256 askAbove, uint256 expires);
    event ToppedUp(uint256 indexed vault, uint256 amount);
    event Withdrawn(uint256 indexed vault, uint256 amount);
    event Paid(uint256 indexed vault, address indexed seller, uint256 amount, uint256 n, bytes32 memo);
    event Requested(uint256 indexed vault, uint256 indexed request, address indexed seller, uint256 amount, bytes32 memo);
    event Decided(uint256 indexed vault, uint256 indexed request, bool approved);
    event Paused(uint256 indexed vault, bool paused);
    event AgentChanged(uint256 indexed vault, address agent);
    event Closed(uint256 indexed vault, uint256 refund);
    event Frozen(address indexed owner, bool frozen);

    error NotOwner();
    error NotAgent();
    error BadInput();
    error VaultPaused();
    error VaultClosed();
    error VaultExpired();
    error OverPerCall();
    error OverDaily();
    error OverSellerDaily();
    error OverBalance();
    error RequestNotWaiting();
    error RequestExpired();
    error TransferFailed();
    error Reentrancy();
    error OwnerFrozen();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner(uint256 id) {
        if (_vaults[id].owner != msg.sender) revert NotOwner();
        _;
    }

    // ---------- owner ----------

    /// @notice Open a vault. Any ETH sent is forwarded to the agent wallet for gas.
    function open(
        address agent,
        address token,
        uint256 deposit,
        uint256 perCall,
        uint256 daily,
        uint256 sellerDaily,
        uint256 askAbove,
        uint256 expires
    ) external payable nonReentrant returns (uint256 id) {
        if (agent == address(0) || token == address(0) || agent == msg.sender) revert BadInput();
        if (perCall == 0 || daily < perCall || expires <= block.timestamp || deposit == 0) revert BadInput();
        if (sellerDaily != 0 && sellerDaily < perCall) revert BadInput();
        uint256 got = _pull(token, deposit);
        id = ++vaultCount;
        Vault storage v = _vaults[id];
        v.owner = msg.sender;
        v.agent = agent;
        v.token = token;
        v.balance = got;
        v.perCall = perCall;
        v.daily = daily;
        v.sellerDaily = sellerDaily;
        v.askAbove = askAbove;
        v.expires = expires;
        _owned[msg.sender].push(id);
        emit Opened(id, msg.sender, agent, token, got, perCall, daily, sellerDaily, askAbove, expires);
        if (msg.value > 0) {
            (bool ok, ) = payable(agent).call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }
    }

    function topUp(uint256 id, uint256 amount) external nonReentrant onlyOwner(id) {
        Vault storage v = _vaults[id];
        if (v.closed) revert VaultClosed();
        if (amount == 0) revert BadInput();
        uint256 got = _pull(v.token, amount);
        v.balance += got;
        emit ToppedUp(id, got);
    }

    function withdraw(uint256 id, uint256 amount) external nonReentrant onlyOwner(id) {
        Vault storage v = _vaults[id];
        if (amount == 0 || amount > v.balance) revert BadInput();
        v.balance -= amount;
        _send(v.token, msg.sender, amount);
        emit Withdrawn(id, amount);
    }

    function setPaused(uint256 id, bool paused) external onlyOwner(id) {
        Vault storage v = _vaults[id];
        if (v.closed) revert VaultClosed();
        v.paused = paused;
        emit Paused(id, paused);
    }

    /// @notice Rotate the agent wallet. The old wallet stops at once.
    function setAgent(uint256 id, address agent) external onlyOwner(id) {
        Vault storage v = _vaults[id];
        if (v.closed) revert VaultClosed();
        if (agent == address(0) || agent == msg.sender) revert BadInput();
        v.agent = agent;
        emit AgentChanged(id, agent);
    }

    /// @notice Close the vault for good and get every remaining token back.
    function close(uint256 id) external nonReentrant onlyOwner(id) {
        Vault storage v = _vaults[id];
        if (v.closed) revert VaultClosed();
        v.closed = true;
        uint256 refund = v.balance;
        v.balance = 0;
        if (refund > 0) _send(v.token, msg.sender, refund);
        emit Closed(id, refund);
    }

    /// @notice Kill switch. Freeze every vault you own in one call, or unfreeze them.
    ///         Frozen vaults keep their funds: you can still withdraw, close, rotate the agent or decline.
    function freezeAll(bool on) external {
        frozen[msg.sender] = on;
        emit Frozen(msg.sender, on);
    }

    function approve(uint256 id, uint256 rid) external nonReentrant onlyOwner(id) {
        Request storage r = _requests[rid];
        if (r.vault != id || r.status != 1) revert RequestNotWaiting();
        if (block.timestamp > r.expires) revert RequestExpired();
        r.status = 2;
        emit Decided(id, rid, true);
        _execute(id, r.seller, r.amount, r.memo);
    }

    function decline(uint256 id, uint256 rid) external onlyOwner(id) {
        Request storage r = _requests[rid];
        if (r.vault != id || r.status != 1) revert RequestNotWaiting();
        r.status = 3;
        emit Decided(id, rid, false);
    }

    // ---------- agent ----------

    /// @notice Pay a seller from the vault. Returns 0 when paid, or a request id when the owner must approve.
    function pay(uint256 id, address seller, uint256 amount, bytes32 memo) external nonReentrant returns (uint256 rid) {
        Vault storage v = _vaults[id];
        if (v.agent != msg.sender || v.agent == address(0)) revert NotAgent();
        if (seller == address(0) || amount == 0) revert BadInput();
        if (v.askAbove != 0 && amount > v.askAbove) {
            _check(v, id, seller, amount); // fail early if it could never pass
            rid = ++requestCount;
            _requests[rid] = Request(id, seller, amount, memo, block.timestamp + REQUEST_TTL, 1);
            _vaultRequests[id].push(rid);
            emit Requested(id, rid, seller, amount, memo);
            return rid;
        }
        _execute(id, seller, amount, memo);
        return 0;
    }

    // ---------- views ----------

    function getVault(uint256 id) external view returns (Vault memory) {
        return _vaults[id];
    }

    function getRequest(uint256 rid) external view returns (Request memory) {
        return _requests[rid];
    }

    function vaultsOf(address owner) external view returns (uint256[] memory) {
        return _owned[owner];
    }

    function requestsOf(uint256 id) external view returns (uint256[] memory) {
        return _vaultRequests[id];
    }

    /// @notice Spent today by the vault, and by one seller.
    function spentToday(uint256 id, address seller) external view returns (uint256 vaultToday, uint256 sellerToday) {
        Vault storage v = _vaults[id];
        uint256 d = block.timestamp / 1 days;
        vaultToday = v.day == d ? v.daySpent : 0;
        sellerToday = _sellerDay[id][seller] == d ? _sellerSpent[id][seller] : 0;
    }

    /// @notice Would this payment go through right now? Returns 0 = yes, 1 = needs owner, 2+ = refused, 10 = owner froze every vault.
    function canPay(uint256 id, address seller, uint256 amount) external view returns (uint8) {
        Vault storage v = _vaults[id];
        if (v.owner == address(0)) return 2;
        if (v.closed) return 3;
        if (frozen[v.owner]) return 10;
        if (v.paused) return 4;
        if (block.timestamp >= v.expires) return 5;
        if (amount > v.perCall) return 6;
        uint256 d = block.timestamp / 1 days;
        if ((v.day == d ? v.daySpent : 0) + amount > v.daily) return 7;
        if (v.sellerDaily != 0 && (_sellerDay[id][seller] == d ? _sellerSpent[id][seller] : 0) + amount > v.sellerDaily) return 8;
        if (amount > v.balance) return 9;
        if (v.askAbove != 0 && amount > v.askAbove) return 1;
        return 0;
    }

    // ---------- internal ----------

    function _check(Vault storage v, uint256 id, address seller, uint256 amount) private view returns (uint256 d, uint256 vToday, uint256 sToday) {
        if (v.closed) revert VaultClosed();
        if (frozen[v.owner]) revert OwnerFrozen();
        if (v.paused) revert VaultPaused();
        if (block.timestamp >= v.expires) revert VaultExpired();
        if (amount > v.perCall) revert OverPerCall();
        d = block.timestamp / 1 days;
        vToday = v.day == d ? v.daySpent : 0;
        if (vToday + amount > v.daily) revert OverDaily();
        sToday = _sellerDay[id][seller] == d ? _sellerSpent[id][seller] : 0;
        if (v.sellerDaily != 0 && sToday + amount > v.sellerDaily) revert OverSellerDaily();
        if (amount > v.balance) revert OverBalance();
    }

    function _execute(uint256 id, address seller, uint256 amount, bytes32 memo) private {
        Vault storage v = _vaults[id];
        (uint256 d, uint256 vToday, uint256 sToday) = _check(v, id, seller, amount);
        v.day = d;
        v.daySpent = vToday + amount;
        _sellerDay[id][seller] = d;
        _sellerSpent[id][seller] = sToday + amount;
        v.balance -= amount;
        v.spent += amount;
        uint256 n = ++v.payments;
        _send(v.token, seller, amount);
        emit Paid(id, seller, amount, n, memo);
    }

    function _pull(address token, uint256 amount) private returns (uint256) {
        uint256 before = IERC20(token).balanceOf(address(this));
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, msg.sender, address(this), amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        uint256 got = IERC20(token).balanceOf(address(this)) - before;
        if (got == 0) revert TransferFailed();
        return got;
    }

    function _send(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
