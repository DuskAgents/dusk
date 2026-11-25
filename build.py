ecc=open('src/ecc.js').read()
open('worker.js','w').write(ecc+'\n'+open('src/worker_body.js').read())
h=open('src/index.src.html').read()
assert '/*ECC*/' in h
open('public/index.html','w').write(h.replace('/*ECC*/',ecc))
