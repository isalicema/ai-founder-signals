# Worker CA compatibility bundle

`letsencrypt-root-yr-by-x1.pem` is the official Let’s Encrypt Root YR certificate
cross-signed by ISRG Root X1:

- Source: https://letsencrypt.org/certs/gen-y/root-yr-by-x1.pem
- SHA-256 fingerprint: `07:26:39:D0:B1:40:D5:BF:FA:E1:6A:D9:C3:F6:CC:60:86:04:06:21:F5:1E:E6:1A:6D:46:A8:91:5C:07:CF:76`

The local worker loads it with `NODE_EXTRA_CA_CERTS`. This preserves normal TLS
verification while allowing Node to validate servers that send `leaf → YR1 →
Root YR` but omit Root YR's X1 cross-certificate. Remove the extra bundle once
Root YR is broadly present in Node trust stores or affected servers send the
default compatibility chain.
