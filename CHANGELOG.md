## [4.1.4](https://github.com/webtorrent/bittorrent-protocol/compare/v4.1.3...v4.1.4) (2023-01-31)


### Bug Fixes

* **deps:** update dependency bencode to ^3.0.2 ([f1582e5](https://github.com/webtorrent/bittorrent-protocol/commit/f1582e56c342e4a75c9ba134b3ecd53affaab77b))

## [4.1.3](https://github.com/webtorrent/bittorrent-protocol/compare/v4.1.2...v4.1.3) (2023-01-26)


### Bug Fixes

* **deps:** update dependency uint8-util to ^2.1.5 ([#105](https://github.com/webtorrent/bittorrent-protocol/issues/105)) ([d16dbdd](https://github.com/webtorrent/bittorrent-protocol/commit/d16dbdd5536e61e5d2cd045286e44fbcdd9064e2))

## [4.1.2](https://github.com/webtorrent/bittorrent-protocol/compare/v4.1.1...v4.1.2) (2023-01-25)


### Bug Fixes

* **deps:** update dependency uint8-util to ^2.1.4 ([#100](https://github.com/webtorrent/bittorrent-protocol/issues/100)) ([b77b355](https://github.com/webtorrent/bittorrent-protocol/commit/b77b3555a4dc98dc41025d35420a0f0661cf574c))

## [4.1.1](https://github.com/webtorrent/bittorrent-protocol/compare/v4.1.0...v4.1.1) (2023-01-25)


### Bug Fixes

* **deps:** update dependency bencode to v3 ([#101](https://github.com/webtorrent/bittorrent-protocol/issues/101)) ([32e02d1](https://github.com/webtorrent/bittorrent-protocol/commit/32e02d14b533c77891b429a1d52135ade47dada8))

# [4.1.0](https://github.com/webtorrent/bittorrent-protocol/compare/v4.0.1...v4.1.0) (2022-12-15)


### Features

* use uint8 instead of buffer ([#99](https://github.com/webtorrent/bittorrent-protocol/issues/99)) ([ad7de65](https://github.com/webtorrent/bittorrent-protocol/commit/ad7de65366fb5c89813a18356422f365bec0da50))

## [4.0.1](https://github.com/webtorrent/bittorrent-protocol/compare/v4.0.0...v4.0.1) (2022-05-14)


### Bug Fixes

* replace speedometer with throughput ([#92](https://github.com/webtorrent/bittorrent-protocol/issues/92)) ([642ac8e](https://github.com/webtorrent/bittorrent-protocol/commit/642ac8e5e2823a7bf3be740246f9f15cf13f17d2))

# [4.0.0](https://github.com/webtorrent/bittorrent-protocol/compare/v3.5.4...v4.0.0) (2022-04-28)


### chore

* release 4 ([08f56ec](https://github.com/webtorrent/bittorrent-protocol/commit/08f56ec8323a4a51922192b98da2c76bb041f0c8))


### BREAKING CHANGES

* ESM only

## [3.5.4](https://github.com/webtorrent/bittorrent-protocol/compare/v3.5.3...v3.5.4) (2022-04-28)


### Code Refactoring

* switch to ESM ([#90](https://github.com/webtorrent/bittorrent-protocol/issues/90)) ([fce2548](https://github.com/webtorrent/bittorrent-protocol/commit/fce254818590b307afb45a3fdaa8e4dc904305ce))


### BREAKING CHANGES

* ESM only

* chore: update imports and export index.js

esm import/export syntax
Signed-off-by: Lakshya Singh <lakshay.singh1108@gmail.com>

* chore: update imports in tests

esm import syntax with path
Signed-off-by: Lakshya Singh <lakshay.singh1108@gmail.com>

* chore: bump bitfield for esm

4.1.0 is esm based while 4.0.0 was commonjs
Signed-off-by: Lakshya Singh <lakshay.singh1108@gmail.com>

* chore: update package.json for esm

specify minimum nodejs version for esm support
exports defined
type change to module
Signed-off-by: Lakshya Singh <lakshay.singh1108@gmail.com>

* chore: update readme with esm syntax

Signed-off-by: Lakshya Singh <lakshay.singh1108@gmail.com>

## [3.5.3](https://github.com/webtorrent/bittorrent-protocol/compare/v3.5.2...v3.5.3) (2022-04-22)


### Bug Fixes

* infinite loop when an allowed-fast request is pending on choke ([#88](https://github.com/webtorrent/bittorrent-protocol/issues/88)) ([a3d28da](https://github.com/webtorrent/bittorrent-protocol/commit/a3d28dac8bcf05af5dd12fe82dfbc7abeed4c55a))

## [3.5.2](https://github.com/webtorrent/bittorrent-protocol/compare/v3.5.1...v3.5.2) (2022-03-27)


### Bug Fixes

* **deps:** update dependency debug to ^4.3.4 ([#85](https://github.com/webtorrent/bittorrent-protocol/issues/85)) ([117ecf3](https://github.com/webtorrent/bittorrent-protocol/commit/117ecf325714142f7643d8cedf434bc58faabb96))

## [3.5.1](https://github.com/webtorrent/bittorrent-protocol/compare/v3.5.0...v3.5.1) (2022-01-20)


### Bug Fixes

* reject on error and activation guards for Fast Extension ([#79](https://github.com/webtorrent/bittorrent-protocol/issues/79)) ([d59075b](https://github.com/webtorrent/bittorrent-protocol/commit/d59075bbb13a3c1ef6baaa64601bf8d2f950bbc2))

# [3.5.0](https://github.com/webtorrent/bittorrent-protocol/compare/v3.4.5...v3.5.0) (2022-01-17)


### Features

* add BEP6 Fast Extension messages ([#75](https://github.com/webtorrent/bittorrent-protocol/issues/75)) ([319136d](https://github.com/webtorrent/bittorrent-protocol/commit/319136d7146135abfb25deade4ae5693d309e79f))

## [3.4.5](https://github.com/webtorrent/bittorrent-protocol/compare/v3.4.4...v3.4.5) (2022-01-17)


### Bug Fixes

* return `this` from `destroy` and `end` ([#74](https://github.com/webtorrent/bittorrent-protocol/issues/74)) ([cba86e5](https://github.com/webtorrent/bittorrent-protocol/commit/cba86e5aff9492b45279cd6ded77e1af3db2c6b5))

## [3.4.4](https://github.com/webtorrent/bittorrent-protocol/compare/v3.4.3...v3.4.4) (2022-01-17)


### Bug Fixes

* **deps:** update dependency bencode to ^2.0.2 ([#63](https://github.com/webtorrent/bittorrent-protocol/issues/63)) ([c022e17](https://github.com/webtorrent/bittorrent-protocol/commit/c022e17efe9d28aaf0c25a087abe75fe27549742))
* **deps:** update dependency debug to ^4.3.3 ([#64](https://github.com/webtorrent/bittorrent-protocol/issues/64)) ([2f2d84c](https://github.com/webtorrent/bittorrent-protocol/commit/2f2d84c7d88b296c98b784da9dca570045630d55))

## [3.4.3](https://github.com/webtorrent/bittorrent-protocol/compare/v3.4.2...v3.4.3) (2021-08-04)


### Bug Fixes

* **deps:** update dependency simple-sha1 to ^3.1.0 ([f3083f6](https://github.com/webtorrent/bittorrent-protocol/commit/f3083f687bf15d351654b2b4a44b3eab6b47188c))

## [3.4.2](https://github.com/webtorrent/bittorrent-protocol/compare/v3.4.1...v3.4.2) (2021-07-08)

## [3.4.1](https://github.com/webtorrent/bittorrent-protocol/compare/v3.4.0...v3.4.1) (2021-06-15)


### Bug Fixes

* modernize ([3d3e244](https://github.com/webtorrent/bittorrent-protocol/commit/3d3e244319036583230d64824ce1388287233e02))

# [3.4.0](https://github.com/webtorrent/bittorrent-protocol/compare/v3.3.2...v3.4.0) (2021-06-15)


### Features

* PE/MSE Implementation for WebTorrent - update for new version ([#48](https://github.com/webtorrent/bittorrent-protocol/issues/48)) ([14f9d81](https://github.com/webtorrent/bittorrent-protocol/commit/14f9d81d07a0d49e4b9460c5392b88bdf0f7bf00))

## [3.3.2](https://github.com/webtorrent/bittorrent-protocol/compare/v3.3.1...v3.3.2) (2021-06-15)


### Bug Fixes

* package.json ([87609ab](https://github.com/webtorrent/bittorrent-protocol/commit/87609abdf8223d4957d9f8c4dd5f06978092a68c))
