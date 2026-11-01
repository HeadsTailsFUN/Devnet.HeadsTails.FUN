# Vendored anchor-syn 0.32.2 (Heads or Tails)

Source: crates.io `anchor-syn 0.32.2` (originally from otter-sec/anchor),
copied verbatim except for the single patch below.

## Patch vs upstream 0.32.2

`src/idl/defined.rs` (~line 499): removed a spurious `.unwrap()` in the
call-site file resolution:

```rust
// before (does not compile on stable Rust):
let source_path = proc_macro2::Span::call_site()
    .unwrap() // <-- yields proc_macro::Span, which has no local_file()
    .local_file()
    .unwrap_or_default();
```

```rust
// after:
let source_path = proc_macro2::Span::call_site()
    .local_file()
    .unwrap_or_default();
```

`proc_macro2::Span::call_site()` already returns `Span`; the extra unwrap
broke `anchor idl build` on stable toolchains. With the fix, an
unresolvable call-site file degrades to the existing empty-path fallback,
so external type-alias lookup is skipped exactly as before.

## Why vendored instead of updated

`anchor-lang`/`anchor-spl`/`orao-solana-vrf` pin the program to the 0.32.x
line (`^0.32`), whose latest release is 0.32.2. There is no newer 0.32.x
with this fixed. Revisit if a fixed 0.32.x (or a compatible ORAO release)
appears; until then this patch keeps `anchor idl build` working.

Wired in via `[patch.crates-io]` in
`programs/heads-or-tails/Cargo.toml`. The patch crate version is identical
(0.32.2), so `Cargo.lock` stays consistent.
