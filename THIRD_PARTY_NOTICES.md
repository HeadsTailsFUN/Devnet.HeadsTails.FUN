# Third-party and asset notices 

## Vendored code

`vendor/anchor-syn` contains anchor-syn 0.32.2 from the Anchor upstream package, with the stable IDL-build compatibility patch documented in `README.HEADSTAILS.md`. Its Apache License 2.0 text is included in `vendor/anchor-syn/LICENSE`. Preserve upstream copyright and license notices. Dependency lockfiles retain exact package identities; no upstream executable binary or cached dependency tree is included.

## Fonts

The application loads Fredoka and Inter through Next.js Google Fonts. Their SIL Open Font License texts are included in `apps/web/public/licenses/Fredoka-OFL.txt` and `Inter-OFL.txt`. Fonts downloaded during builds retain their upstream licenses. Font provenance: the Google Fonts repository, `ofl/fredoka` and `ofl/inter`.

## Application dependencies

JavaScript dependencies are declared in package.json files and pinned in pnpm-lock.yaml; Rust dependencies are pinned in Cargo.lock. Each dependency retains its own upstream license. These dependency declarations do not sublicense original project code. Generated dependency directories, binaries, and source maps are excluded from the export.

## Brand and image assets

The combined HeadsTails coin, HEADS dog, TAILS cat, arena artwork, and favicon are existing project assets preserved for the candidate. The square HTS logo uses transparent padding around the original combined coin; it was not regenerated. The owner authorized publication of the existing release artwork with this source. No broader artwork reuse license is granted. Original author/source records are retained privately and are not replaced by an invented license here.

Wallet logos in `apps/web/public/assets/wallets` identify the corresponding wallet products. They remain third-party trademarks; no endorsement or blanket redistribution license is claimed. Their inclusion identifies supported integrations; no trademark ownership or broad license is claimed.

## Project license

The owner has not selected an original project-code or artwork license. This publication grants no new project-wide reuse rights. No MIT or other project license has been fabricated.


## Cached Fredoka/Inter fonts

The previously built Google Fonts bytes are preserved under apps/web/public/fonts. See FREDOKA-OFL.txt and INTER-OFL.txt there for the SIL Open Font License and attribution. No original font bytes were modified.
