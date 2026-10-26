# DEMO KEYS: PUBLIC ON PURPOSE. NEVER USE THEM FOR REAL DATA.

These private keys sign the sample Proof Pack for the fictional firm
"Maple Street Tax & Bookkeeping (sample)". They are committed so that anyone
can regenerate the demo byte for byte:

    cd engine && go run ./cmd/proofctl demo generate --keys ../demo/demo-keys --out ../demo

Because they are public, **anyone can sign anything with them**. A pack that
verifies against `../data/trust-policy.json` proves nothing about any real
business. Every key file says `"demo_only": true`, and the generator refuses
keys without that flag. Real deployments generate keys inside a TPM, Secure
Enclave or KMS and never write private keys to disk.
