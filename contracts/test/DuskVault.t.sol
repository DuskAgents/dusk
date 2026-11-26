// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/DuskVault.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function deal(address, uint256) external;
    function expectRevert(bytes4) external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { require(balanceOf[msg.sender] >= a, "bal"); balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allow"); require(balanceOf[f] >= a, "bal");
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

contract DuskVaultTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    DuskVault vault;
    MockToken usd;
    address owner = address(0xA11CE);
    address agent = address(0xA9E47);
    address seller = address(0x5E11E7);
    address seller2 = address(0x5E11E8);
    uint256 constant U = 1e6;

    function setUp() public {
        vm.warp(1_800_000_000);
        vault = new DuskVault();
        usd = new MockToken();
        usd.mint(owner, 1000 * U);
        vm.prank(owner);
        usd.approve(address(vault), type(uint256).max);
    }

    function _open(uint256 askAbove, uint256 sellerDaily) internal returns (uint256 id) {
        vm.prank(owner);
        id = vault.open(agent, address(usd), 100 * U, 5 * U, 20 * U, sellerDaily, askAbove, block.timestamp + 30 days);
    }

    function eq(uint256 a, uint256 b, string memory m) internal pure { require(a == b, m); }

    function testOpenAndPay() public {
        uint256 id = _open(0, 0);
        DuskVault.Vault memory v = vault.getVault(id);
        eq(v.balance, 100 * U, "balance");
        require(v.owner == owner && v.agent == agent, "roles");
        vm.prank(agent);
        uint256 rid = vault.pay(id, seller, 3 * U, bytes32("search"));
        eq(rid, 0, "paid now");
        eq(usd.balanceOf(seller), 3 * U, "seller got paid");
        v = vault.getVault(id);
        eq(v.balance, 97 * U, "balance after");
        eq(v.spent, 3 * U, "spent");
        eq(v.payments, 1, "payments");
        eq(vault.vaultsOf(owner).length, 1, "owned");
    }

    function testOnlyAgentPays() public {
        uint256 id = _open(0, 0);
        vm.prank(seller);
        vm.expectRevert(DuskVault.NotAgent.selector);
        vault.pay(id, seller, 1 * U, bytes32(0));
        vm.prank(owner);
        vm.expectRevert(DuskVault.NotAgent.selector);
        vault.pay(id, seller, 1 * U, bytes32(0));
    }

    function testPerCall() public {
        uint256 id = _open(0, 0);
        vm.prank(agent);
        vm.expectRevert(DuskVault.OverPerCall.selector);
        vault.pay(id, seller, 6 * U, bytes32(0));
    }

    function testDailyAndRollover() public {
        uint256 id = _open(0, 0);
        vm.startPrank(agent);
        for (uint256 i = 0; i < 4; i++) vault.pay(id, seller, 5 * U, bytes32(0));
        vm.expectRevert(DuskVault.OverDaily.selector);
        vault.pay(id, seller, 1, bytes32(0));
        vm.stopPrank();
        eq(vault.canPay(id, seller, 1), 7, "canPay daily");
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vault.pay(id, seller, 5 * U, bytes32(0));
        eq(usd.balanceOf(seller), 25 * U, "rollover");
    }

    function testSellerDaily() public {
        uint256 id = _open(0, 8 * U);
        vm.startPrank(agent);
        vault.pay(id, seller, 5 * U, bytes32(0));
        vm.expectRevert(DuskVault.OverSellerDaily.selector);
        vault.pay(id, seller, 4 * U, bytes32(0));
        vault.pay(id, seller2, 5 * U, bytes32(0));
        vm.stopPrank();
        eq(usd.balanceOf(seller2), 5 * U, "other seller ok");
    }

    function testAskAboveApprove() public {
        uint256 id = _open(2 * U, 0);
        vm.prank(agent);
        uint256 rid = vault.pay(id, seller, 4 * U, bytes32("filing"));
        require(rid != 0, "request made");
        eq(usd.balanceOf(seller), 0, "not paid yet");
        eq(vault.canPay(id, seller, 4 * U), 1, "canPay needs owner");
        vm.prank(agent);
        vm.expectRevert(DuskVault.NotOwner.selector);
        vault.approve(id, rid);
        vm.prank(owner);
        vault.approve(id, rid);
        eq(usd.balanceOf(seller), 4 * U, "paid after approve");
        vm.prank(owner);
        vm.expectRevert(DuskVault.RequestNotWaiting.selector);
        vault.approve(id, rid);
    }

    function testAskAboveDeclineAndExpiry() public {
        uint256 id = _open(2 * U, 0);
        vm.startPrank(agent);
        uint256 r1 = vault.pay(id, seller, 3 * U, bytes32(0));
        uint256 r2 = vault.pay(id, seller, 3 * U, bytes32(0));
        vm.stopPrank();
        vm.prank(owner);
        vault.decline(id, r1);
        eq(vault.getRequest(r1).status, 3, "declined");
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(owner);
        vm.expectRevert(DuskVault.RequestExpired.selector);
        vault.approve(id, r2);
        eq(usd.balanceOf(seller), 0, "nothing paid");
    }

    function testPauseResume() public {
        uint256 id = _open(0, 0);
        vm.prank(owner);
        vault.setPaused(id, true);
        vm.prank(agent);
        vm.expectRevert(DuskVault.VaultPaused.selector);
        vault.pay(id, seller, 1 * U, bytes32(0));
        vm.prank(owner);
        vault.setPaused(id, false);
        vm.prank(agent);
        vault.pay(id, seller, 1 * U, bytes32(0));
    }

    function testRotateAgent() public {
        uint256 id = _open(0, 0);
        address next = address(0xBEEF);
        vm.prank(owner);
        vault.setAgent(id, next);
        vm.prank(agent);
        vm.expectRevert(DuskVault.NotAgent.selector);
        vault.pay(id, seller, 1 * U, bytes32(0));
        vm.prank(next);
        vault.pay(id, seller, 1 * U, bytes32(0));
    }

    function testCloseRefunds() public {
        uint256 id = _open(0, 0);
        vm.prank(agent);
        vault.pay(id, seller, 5 * U, bytes32(0));
        vm.prank(owner);
        vault.close(id);
        eq(usd.balanceOf(owner), 995 * U, "refund");
        vm.prank(agent);
        vm.expectRevert(DuskVault.VaultClosed.selector);
        vault.pay(id, seller, 1 * U, bytes32(0));
        vm.prank(seller);
        vm.expectRevert(DuskVault.NotOwner.selector);
        vault.close(id);
    }

    function testExpiry() public {
        uint256 id = _open(0, 0);
        vm.warp(block.timestamp + 31 days);
        vm.prank(agent);
        vm.expectRevert(DuskVault.VaultExpired.selector);
        vault.pay(id, seller, 1 * U, bytes32(0));
        vm.prank(owner);
        vault.withdraw(id, 100 * U);
        eq(usd.balanceOf(owner), 1000 * U, "owner gets funds back after expiry");
    }

    function testTopUpAndBalanceLimit() public {
        uint256 id = _open(0, 0);
        vm.prank(owner);
        vault.withdraw(id, 98 * U);
        vm.prank(agent);
        vm.expectRevert(DuskVault.OverBalance.selector);
        vault.pay(id, seller, 3 * U, bytes32(0));
        vm.prank(owner);
        vault.topUp(id, 10 * U);
        vm.prank(agent);
        vault.pay(id, seller, 3 * U, bytes32(0));
    }

    function testGasForwardedToAgent() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        vault.open{value: 0.01 ether}(agent, address(usd), 10 * U, 1 * U, 2 * U, 0, 0, block.timestamp + 1 days);
        eq(agent.balance, 0.01 ether, "gas sent to agent");
    }

    function testBadInputs() public {
        vm.startPrank(owner);
        vm.expectRevert(DuskVault.BadInput.selector);
        vault.open(address(0), address(usd), 10 * U, 1 * U, 2 * U, 0, 0, block.timestamp + 1 days);
        vm.expectRevert(DuskVault.BadInput.selector);
        vault.open(agent, address(usd), 10 * U, 3 * U, 2 * U, 0, 0, block.timestamp + 1 days);
        vm.expectRevert(DuskVault.BadInput.selector);
        vault.open(agent, address(usd), 10 * U, 1 * U, 2 * U, 0, 0, block.timestamp);
        vm.expectRevert(DuskVault.BadInput.selector);
        vault.open(owner, address(usd), 10 * U, 1 * U, 2 * U, 0, 0, block.timestamp + 1 days);
        vm.stopPrank();
    }

    function testKillSwitch() public {
        uint256 a = _open(0, 0);
        uint256 b = _open(1 * U, 0);
        vm.prank(agent);
        uint256 rid = vault.pay(b, seller, 2 * U, bytes32("big"));
        require(rid != 0, "waiting");
        vm.prank(seller);
        vault.freezeAll(true);
        require(!vault.frozen(owner), "others cannot freeze me");
        vm.prank(owner);
        vault.freezeAll(true);
        require(vault.frozen(owner), "frozen");
        eq(vault.canPay(a, seller, 1 * U), 10, "canPay frozen a");
        eq(vault.canPay(b, seller, 1 * U), 10, "canPay frozen b");
        vm.prank(agent);
        vm.expectRevert(DuskVault.OwnerFrozen.selector);
        vault.pay(a, seller, 1 * U, bytes32(0));
        vm.prank(agent);
        vm.expectRevert(DuskVault.OwnerFrozen.selector);
        vault.pay(b, seller, 2 * U, bytes32(0));
        vm.prank(owner);
        vm.expectRevert(DuskVault.OwnerFrozen.selector);
        vault.approve(b, rid);
        eq(usd.balanceOf(seller), 0, "nothing moved");
        vm.prank(owner);
        vault.withdraw(a, 10 * U);
        eq(usd.balanceOf(owner), 810 * U, "withdraw works while frozen");
        vm.prank(owner);
        vault.freezeAll(false);
        eq(vault.canPay(a, seller, 1 * U), 0, "canPay ok");
        vm.prank(agent);
        vault.pay(a, seller, 1 * U, bytes32(0));
        vm.prank(owner);
        vault.approve(b, rid);
        eq(usd.balanceOf(seller), 3 * U, "paid after unfreeze");
    }
}
