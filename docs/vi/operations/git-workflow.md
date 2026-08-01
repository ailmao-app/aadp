# Quy trình Git cho repository AADP

> Trạng thái: Active.
>
> Owner: Maintainer/contributor của repository `aadp`.
>
> Phạm vi: Quy ước branch, thứ tự merge và điểm chạm với CI (bao gồm
> `release-gate`) từ lúc bắt đầu một thay đổi đến lúc tag release. Quy trình
> publish npm chi tiết nằm ở [`npm-release-guide.md`](npm-release-guide.md) —
> tài liệu này chỉ dừng ở bước tạo và push tag.

## 1. Các loại branch

| Branch | Cắt từ | Mục đích |
|---|---|---|
| `develop` | — | Nhánh tích hợp, luôn chứa các thay đổi đã merge nhưng chưa release. |
| `feat/*`, `fix/*`, `docs/*`, ... | `develop` | Một thay đổi cụ thể. Tên bắt buộc có prefix loại thay đổi (`feat/`, `fix/`, `docs/`, ...), không dùng tên mô tả trần. |
| `release/x.y.z` | `main` | Release candidate cho version `x.y.z`. Không phát triển tính năng mới trên branch này — chỉ nhận `develop` merge vào và các fix phát sinh khi release. |
| `main` | — | Trạng thái đã release. Mỗi commit trên `main` (sau merge từ `release/*`) tương ứng một tag `vX.Y.Z`. |

Quy tắc đặt tên branch, xem chi tiết ở CLAUDE.md của workspace: luôn dùng dạng
`type/mo-ta-ngan`, ví dụ `feat/aadp-compat-interop-hardening`, không dùng tên
chung chung.

## 2. Vòng đời một thay đổi

```text
feat/xxx ──PR──> develop ──merge──> release/x.y.z ──PR──> main ──tag──> vX.Y.Z
```

### Bước 1 — Phát triển trên `feat/*`

```bash
git checkout develop
git pull
git checkout -b feat/ten-tinh-nang
# ... code, commit ...
git push origin feat/ten-tinh-nang
```

Mở PR vào `develop`. CI chạy `build-test-audit` (matrix Node 20.19.0 +
22.12.0: `docs:check`, `build`, `test`, `audit`, `pack --dry-run`) trên PR này.

### Bước 2 — Merge `feat/*` vào `develop`

```bash
git checkout develop
git pull
git merge --no-ff feat/ten-tinh-nang
git push origin develop
```

`develop` là nơi tích lũy nhiều `feat/*`/`fix/*` cho tới khi đủ để cắt release.

### Bước 3 — Cắt `release/x.y.z` từ `main`

```bash
git checkout main
git pull
git checkout -b release/x.y.z
```

### Bước 4 — Merge `develop` vào `release/x.y.z`

```bash
git merge --no-ff origin/develop
git push origin release/x.y.z
```

Nếu cần bump `package.json`/`package-lock.json`/`CHANGELOG.md`, làm trên
`release/x.y.z` tại bước này (trừ khi đã bump từ trước trên `feat/*` — báo lại
với người review nếu có sai khác).

### Bước 5 — Merge `release/x.y.z` vào `main`

Mở PR `release/x.y.z` → `main`. CI chạy `build-test-audit` trên PR này —
đây là lần kiểm tra cuối cùng trước khi có tag.

### Bước 6 — Tạo và push tag

```bash
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

**Đây là điểm chạm duy nhất với job `release-gate`.** Xem §3.

## 3. CI: `build-test-audit` vs `release-gate`

File: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).

```yaml
on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
```

- **`build-test-audit`**: chạy trên mọi `pull_request` và trên push vào
  `main`/tag `v*`. Matrix Node `20.19.0` và `22.12.0` — **không phải** sàn
  `engines` của `package.json` (`>=20.18.1`, lời hứa cho consumer cài package,
  chỉ phụ thuộc `ajv`/`commander`/`undici`). `20.19.0` là Node cũ nhất mà
  toolchain dev của repo (`vitest@4` → `rolldown`) chạy được — `20.18.1`
  không thỏa engine range của `rolldown` (`^20.19.0 || >=22.12.0`) và làm
  `npm test` crash với `Cannot find native binding` (xem `ERROR_LOG.md`
  2026-07-29 và 2026-08-01 — nhầm lẫn này đã xảy ra 2 lần). Chạy
  `docs:check`, `build`, `test`, `audit --omit=dev`, `pack --dry-run`.
- **`release-gate`**: `if: startsWith(github.ref, 'refs/tags/v')` — **chỉ**
  chạy khi push tag dạng `vX.Y.Z`, không chạy khi push branch hay mở PR. Chạy
  `npm run check:release-consistency` (`scripts/check-release-consistency.mjs`),
  xác nhận `package.json`, `package-lock.json`, `CHANGELOG.md` và chính tag
  Git đó đều khớp version.

Nói cách khác: `feat/*` → `develop` → `release/*` → `main` chỉ đi qua
`build-test-audit` (review bình thường qua PR). `release-gate` là bước gác
cuối cùng, cố ý tách riêng vì kiểm tra "version khớp changelog" không có ý
nghĩa ở giữa hai lần release — repo luôn hợp lệ ở trạng thái "đi trước"
changelog cho tới khi thực sự tag.

Nếu `release-gate` fail (vd. quên bump version trên `release/x.y.z`, hoặc tag
nhầm số), sửa rồi xóa tag cũ, tag lại:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# sửa lỗi, commit, push
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 4. Sau khi `release-gate` xanh

CI hiện **không** tự động `npm publish` (quyết định vận hành cần chốt riêng —
xem §8 của [`npm-release-guide.md`](npm-release-guide.md)). Thực hiện phần
publish thủ công theo tài liệu đó.

## 5. Việc KHÔNG được làm

- Không commit hoặc sửa file trực tiếp trên `main`.
- Không tự ý chạy `git push`/tạo tag mà không được xác nhận trước.
- Không tạo `release/*` mới khi `release/*` hiện tại chưa merge vào `main`,
  trừ khi chủ đích release song song (hiếm, cần trao đổi trước).
- Không bỏ qua `release-gate` bằng cách publish trước khi tag được push và
  CI báo xanh.
