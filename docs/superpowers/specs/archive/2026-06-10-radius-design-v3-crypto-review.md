# Radius v3 crypto-only review

## Verdict

Needs 2 correctness fixes first: enforce AEAD nonce uniqueness for the reused/bidirectional handshake keys, and tighten replay-counter semantics to be per AEAD key/direction and advanced only after tag verification.

## Findings

1. **correctness-bug — `K_pair` / `K_auth_handshake` can reuse ChaChaPoly nonces under one key.** RFC 8439 §2.8 requires a 96-bit nonce that is different for every invocation with the same key; §4 says reuse repeats both keystream and Poly1305 one-time key. As written, `K_pair` is bidirectional and both one-shot frames can use counter 0; a 4-byte prefix collision repeats the nonce. `K_auth_handshake` is worse: it is static across reconnects, so counter reset + only 32 random prefix bits gives birthday-risk nonce reuse across sessions. **Edit:** split bidirectional keys in §5.4.2 (`K_pair_c2s`, `K_pair_s2c`, `K_auth_c2s`, `K_auth_s2c` with role-specific `info` strings), and state in §5.4.1/§5.4.4 that any key that outlives a connection uses a persisted monotonic nonce counter per peer/direction; app counters may start at 0 only because app keys are per-connection.

2. **correctness-bug — replay counters are scoped too broadly/ambiguously.** Nonce uniqueness is per `(AEAD key, nonce)`, not per `(frameType, direction)`; AAD does not make nonce reuse safe. If future frame types share a key and each gets counter 0, that is a ChaChaPoly nonce collision. Also do not update `lastCounter` before authentication, or a forged high-counter frame can desynchronize the stream. **Edit:** replace `lastCounter[(direction, frameType)]` with `lastCounter[(keyId, direction)]`; reject duplicates before plaintext use but persist/advance the counter only after `aead_decrypt` succeeds.

3. **robustness — add X25519 all-zero shared-secret rejection.** RFC 7748 §6.1 permits checking for all-zero output; §7 warns about small-order inputs and non-contributory behavior. **Edit:** after every `X25519(...)`, abort if the 32-byte result is all zero; define “well-formed public key” in §5.4.3/§5.4.4 as exactly 32 bytes and not producing all-zero DH with the local private key.

4. **clarity — HKDF schedule is otherwise sound, but specify CryptoKit/Node equivalence.** RFC 5869 §2.2 uses raw IKM in Extract; §3.1 allows absent/empty salt behavior; §3.2 uses `info` for domain separation. The table correctly uses raw X25519 shared secrets as IKM, 32-byte output is correct for RFC 8439’s 256-bit key, and sharing the app salt while separating `c2s`/`s2c` by `info` is sufficient. **Edit:** add: “In Swift, use `SharedSecret.hkdfDerivedSymmetricKey(...)` directly; in Node, use the raw 32-byte `crypto.diffieHellman(...)` result as HKDF IKM. Never feed a previously derived `K_*` as IKM.”

5. **clarity — ChaChaPoly framing/API conventions are OK; spell out the exact bytes.** RFC 8439 §2.8 MACs AAD and ciphertext and outputs `ciphertext || 16-byte tag`; §4 says do not truncate the tag. **Edit:** add that Swift must transmit `sealedBox.ciphertext || sealedBox.tag` while carrying the nonce in the frame header (not `sealedBox.combined`, unless stripping its nonce), and Node must append `cipher.getAuthTag()` after ciphertext.

## Sanity-check test vectors

- **X25519:** RFC 7748 §6.1 Curve25519 DH vector: Alice/Bob public keys and shared secret must match byte-for-byte in Swift and Node; also useful: RFC 7748 §5.2 one-iteration basepoint vector.
- **HKDF-SHA256:** RFC 5869 Appendix A.1 and A.3, especially A.3 for zero-length salt/info behavior.
- **ChaCha20-Poly1305 AEAD:** RFC 8439 §2.8.2 encryption vector and Appendix A.5 decryption vector, verifying 12-byte nonce, AAD, ciphertext, and 16-byte tag layout.
