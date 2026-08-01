# Hướng dẫn phát hành package AADP lên npm

> Trạng thái: Active.
>
> Owner: Maintainer có quyền release package `ail-aadp`.
>
> Phạm vi: Quy trình chuẩn bị, kiểm tra, publish, xác minh và phục hồi release npm.

Tài liệu này hướng dẫn maintainer build, kiểm tra và phát hành package
`ail-aadp` lên npm registry. Lệnh được chạy từ thư mục gốc của repository
`aadp`.

> Publish là thao tác không thể ghi đè: npm không cho phát hành lại cùng một
> `name@version`, kể cả sau khi version đó bị gỡ. Luôn kiểm tra version và
> tarball trước khi chạy `npm publish`.

## 1. Điều kiện trước khi phát hành

- Node.js `>=20.18.1`, đúng với `engines` trong `package.json`.
- npm CLI tương thích với phiên bản Node.js đang sử dụng.
- Tài khoản npm có quyền publish package `ail-aadp`.
- Tài khoản đã bật 2FA cho thao tác ghi, hoặc sử dụng cơ chế xác thực được npm
  cho phép tại thời điểm publish.
- Branch phát hành đã được review; worktree không chứa thay đổi ngoài release.
- `CHANGELOG.md` đã mô tả thay đổi của version sắp phát hành.

Kiểm tra môi trường:

```bash
cd aadp
node --version
npm --version
npm config get registry
npm whoami
git status --short
```

Registry phải là:

```text
https://registry.npmjs.org/
```

Nếu đang trỏ tới registry khác:

```bash
npm config set registry https://registry.npmjs.org/
```

Không commit access token hoặc file `.npmrc` chứa token vào repository.

## 2. Chọn version

AADP sử dụng Semantic Versioning:

- `patch`: sửa lỗi tương thích ngược, ví dụ `1.0.3` → `1.0.4`.
- `minor`: thêm tính năng tương thích ngược, ví dụ `1.0.3` → `1.1.0`.
- `major`: thay đổi contract không tương thích, ví dụ `1.0.3` → `2.0.0`.

Kiểm tra version local và version đã có trên npm:

```bash
npm pkg get name version
npm view ail-aadp version
```

Cập nhật `package.json` và `package-lock.json` mà chưa tạo Git tag:

```bash
npm version patch --no-git-tag-version
```

Thay `patch` bằng `minor`, `major` hoặc một version cụ thể khi cần:

```bash
npm version 1.1.0 --no-git-tag-version
```

Sau khi đổi version, kiểm tra diff để bảo đảm chỉ có các thay đổi release mong
muốn:

```bash
git diff -- package.json package-lock.json CHANGELOG.md
```

Sau khi review, commit version và changelog trước khi tạo tarball cuối cùng. Mọi
bước pack, smoke test và publish bên dưới MUST chạy từ clean commit đó:

```bash
git status --short
git rev-parse HEAD
```

Không sửa version của wire contract AADP chỉ vì tăng version package npm. Hai
version này có lifecycle riêng.

## 3. Cài đặt và chạy release gate

Cài dependency từ lockfile, build và chạy toàn bộ test:

```bash
npm ci
npm run build
npm test
```

Nếu một bước thất bại, dừng release và sửa nguyên nhân trước khi tiếp tục. Không
publish bằng cách bỏ qua test hoặc dùng `--force`.

## 4. Kiểm tra nội dung tarball

Xem trước danh sách file npm sẽ đóng gói:

```bash
npm pack --dry-run
```

Tarball phải chứa tối thiểu:

- `dist/`
- `schemas/`
- `spec/`
- `examples/`
- `scripts/`
- `README.md`
- `CHANGELOG.md`
- `package.json`

Tarball không được chứa source bí mật, credential, file môi trường, fixture dữ
liệu riêng tư hoặc file build ngoài phạm vi package.

Tạo tarball thật để kiểm tra:

```bash
npm pack
```

Lệnh trả về tên file dạng `ail-aadp-<version>.tgz`. Có thể kiểm tra metadata và
danh sách file:

```bash
npm pack --json
tar -tzf ail-aadp-<version>.tgz
```

Kiểm tra cài đặt từ đúng artifact sẽ được phát hành trong một thư mục tạm:

```bash
release_test_dir="$(mktemp -d)"
cd "$release_test_dir"
npm init -y
npm install /duong-dan-tuyet-doi/ail-aadp-<version>.tgz
node --input-type=module -e "import('ail-aadp').then(() => console.log('import ok'))"
npx aadp-validate --help
```

Sau khi smoke test hoàn tất, quay lại repository `aadp`. Có thể xóa tarball local
sau khi đã đối chiếu checksum hoặc lưu nó làm release artifact theo policy của
dự án.

## 5. Publish thủ công

Đăng nhập nếu `npm whoami` chưa nhận diện đúng maintainer:

```bash
npm login
npm whoami
```

Kiểm tra lần cuối package identity:

```bash
npm pkg get name version
npm view "ail-aadp@<version>" version
```

Nếu lệnh `npm view` tìm thấy version chuẩn bị publish, phải chọn version mới.

Publish đúng tarball đã smoke test, không đóng gói lại một working tree có thể đã
thay đổi:

```bash
npm publish "./ail-aadp-<version>.tgz" --access public
```

Khi npm yêu cầu OTP, nhập mã 2FA trực tiếp tại prompt. Không ghi OTP hoặc token
vào command history, source code hay tài liệu release.

Với prerelease, dùng dist-tag riêng để không thay đổi `latest`:

```bash
npm version 1.1.0-beta.1 --no-git-tag-version
npm ci
npm run build
npm test
npm pack
npm publish "./ail-aadp-1.1.0-beta.1.tgz" --access public --tag beta
```

Chỉ dùng tag `latest` cho stable release đã vượt qua toàn bộ release gate.

## 6. Xác minh sau publish

Đợi registry cập nhật rồi kiểm tra:

```bash
npm view "ail-aadp@<version>" name version dist-tags dist.integrity
npm view ail-aadp dist-tags
```

Smoke test từ registry trong một project trống:

```bash
registry_test_dir="$(mktemp -d)"
cd "$registry_test_dir"
npm init -y
npm install "ail-aadp@<version>"
node --input-type=module -e "import('ail-aadp').then(() => console.log('import ok'))"
npx aadp-validate --help
```

Release commit và changelog MUST được review và commit trước khi tạo tarball cuối
cùng. Tarball được smoke test MUST được tạo từ đúng clean commit sẽ gắn tag; không
publish artifact được tạo từ working tree chưa commit.

Sau khi xác minh thành công:

1. Xác nhận Git commit hiện tại đúng commit đã tạo tarball.
2. Tạo Git tag trùng với package version, ví dụ `v1.0.7`.
3. Push tag theo quy trình review của repository.
4. Tạo GitHub Release nếu dự án sử dụng release artifact.

Không tạo hoặc push tag trước khi biết chắc release candidate đã vượt qua release
gate, trừ khi repository áp dụng workflow publish tự động từ tag.

## 7. Xử lý release có lỗi

Không thể sửa trực tiếp artifact đã publish và không thể tái sử dụng cùng version.
Ưu tiên:

1. Dừng quảng bá release lỗi.
2. Đánh dấu version không nên sử dụng:

   ```bash
   npm deprecate "ail-aadp@<version>" "Không sử dụng version này; hãy nâng cấp lên <fixed-version>."
   ```

3. Sửa lỗi, tăng `patch` version, chạy lại toàn bộ release gate và publish version
   mới.
4. Chỉ dùng `npm unpublish` khi đáp ứng policy hiện hành của npm và đã đánh giá
   ảnh hưởng tới consumer.

Nếu lỗi liên quan credential, thu hồi token ngay trên npm, kiểm tra audit log và
rotate mọi secret có khả năng đã bị lộ.

## 8. Publish tự động bằng CI

Với release định kỳ, ưu tiên npm Trusted Publishing từ GitHub Actions hoặc GitLab
CI thay vì lưu token dài hạn trong repository secrets. Workflow CI tối thiểu phải:

1. Checkout đúng commit/tag phát hành.
2. Dùng Node.js đáp ứng `engines`.
3. Chạy `npm ci`, `npm run build` và `npm test`.
4. Chạy `npm pack --dry-run` hoặc kiểm tra tarball tương đương.
5. Publish từ môi trường và repository đã đăng ký làm trusted publisher.
6. Dùng approval environment cho stable release nếu repository yêu cầu.

Không thêm workflow tự động trước khi maintainer chốt trigger, quyền GitHub
environment, npm trusted publisher và policy tạo tag. Cấu hình sai có thể publish
nhầm version hoặc mở rộng quyền ghi ngoài ý muốn.

Tài liệu npm tham khảo:

- [Publishing packages](https://docs.npmjs.com/cli/publish/)
- [Yêu cầu 2FA khi publish](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
- [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [Provenance statements](https://docs.npmjs.com/generating-provenance-statements/)

## 9. Checklist release

- [ ] Version npm đúng và chưa tồn tại trên registry.
- [ ] `CHANGELOG.md` đã cập nhật.
- [ ] Worktree không có thay đổi ngoài release.
- [ ] `npm ci` thành công.
- [ ] `npm run build` thành công.
- [ ] `npm test` thành công.
- [ ] `npm pack --dry-run` chỉ chứa file mong muốn.
- [ ] Cài tarball local và smoke test thành công.
- [ ] Đúng npm account, registry và package access.
- [ ] Publish với đúng dist-tag.
- [ ] Cài package từ registry và smoke test thành công.
- [ ] Release commit, Git tag và release notes khớp với artifact đã publish.
