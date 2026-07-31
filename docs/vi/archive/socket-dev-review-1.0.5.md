# Review điểm Socket.dev cho `ail-aadp@1.0.5`

> Trạng thái: Historical snapshot.
>
> Phạm vi: Chỉ phản ánh package `1.0.5` và repository tại commit `6cf46ea`.
> Các số liệu version, test, tarball, dependency, license và Socket score MUST
> NOT được dùng để đánh giá release hiện tại. Muốn có kết luận hiện hành phải
> thực hiện review mới.

Ngày review: 2026-07-29

## Kết luận

Điểm Socket.dev 77/100 **không cho thấy package đang có lỗ hổng nghiêm trọng hoặc mã độc**. Qua kiểm tra source code, dependency tree và nội dung package phát hành, chưa phát hiện vấn đề Critical/High cần chặn phát hành.

Nguyên nhân hợp lý nhất làm điểm chưa cao là các tín hiệu về độ trưởng thành và chuỗi cung ứng:

- package mới được tạo ngày 2026-07-23;
- mới có một npm maintainer;
- repository chưa có CI/security workflow được commit;
- package khai báo giấy phép MIT nhưng chưa có file `LICENSE`;
- chưa có bằng chứng npm provenance/trusted publishing trong repository;
- package có khả năng truy cập mạng và filesystem do chức năng thực tế của client, conformance CLI và scaffold CLI.

Socket tính điểm từ nhiều nhóm gồm Supply Chain, Quality, Maintenance, Vulnerability và License. Điểm còn phụ thuộc độ phổ biến, tuổi package, số maintainer, nhịp phát hành, dependency và các capability được static analysis phát hiện; vì vậy 77 không tương đương “code chỉ đạt 77 điểm”. Socket cũng ghi rõ công thức có thể thay đổi theo thời gian.

Tài liệu tham chiếu:

- [Socket Package Scores](https://docs.socket.dev/docs/package-scores)
- [Socket Supply Chain Risk](https://docs.socket.dev/docs/supply-chain-risk)
- [Socket CLI package score](https://docs.socket.dev/docs/socket-package)

## Phạm vi và phương pháp

Đã kiểm tra:

- source TypeScript trong `src`;
- script phát hành trong `scripts`;
- `package.json`, `package-lock.json` và dependency tree;
- nội dung tarball bằng `npm pack --dry-run --json`;
- metadata đã publish trên npm của `ail-aadp@1.0.5`;
- test, build và audit tại commit `6cf46ea`.

Không lấy được breakdown trực tiếp của Socket.dev trong môi trường review:

- Socket CLI yêu cầu API token;
- trang web package bị Cloudflare challenge khi truy cập tự động.

Do đó, số 77 là số đầu vào do người dùng cung cấp; phần nguyên nhân bên dưới là kết luận từ bằng chứng local, npm registry và tiêu chí công khai của Socket, không phải bản sao alert list riêng của Socket.

## Kết quả xác minh

| Hạng mục | Kết quả |
| --- | --- |
| Unit/integration test | 17 test files pass, 325/325 test pass |
| TypeScript build | Pass |
| `npm audit --omit=dev` | 0 vulnerability |
| `npm audit` toàn bộ tree | 0 vulnerability |
| Production dependency | 4 direct, 9 package trong production tree |
| Tarball | 96 files, 92.198 bytes nén, 322.809 bytes giải nén |
| Install lifecycle script | Không có `preinstall`, `install`, `postinstall`, `prepare` |
| Mã nguy hiểm điển hình | Không thấy `eval`, `new Function`, `child_process` hoặc thực thi shell |
| Chữ ký npm registry | Có registry signature |
| Git tree | Sạch trước khi tạo báo cáo |

## Findings

### R-01 — Thiếu file `LICENSE`

Mức độ: Medium về metadata/độ tin cậy, không phải lỗ hổng runtime.

`package.json` khai báo `"license": "MIT"` nhưng repository và tarball không có file `LICENSE`. Điều này có thể làm giảm tín hiệu License/Quality và khiến người dùng package không nhận được toàn văn giấy phép trong artifact.

Bằng chứng:

- `package.json:17` khai báo MIT;
- `package.json:70-78` không liệt kê `LICENSE`;
- kết quả `npm pack --dry-run` không có `LICENSE`.

Khuyến nghị:

1. Thêm file `LICENSE` chuẩn MIT, đúng tên chủ sở hữu và năm.
2. Có thể thêm `"LICENSE"` vào `files` để thể hiện chủ đích, dù npm thường tự bao gồm file giấy phép theo tên chuẩn.
3. Xác nhận lại bằng `npm pack --dry-run`.

### R-02 — Chưa có CI và publish provenance trong repository

Mức độ: Medium về supply-chain assurance.

Repository `aadp` không có `.github/workflows`. Vì vậy source hiện tại chưa cung cấp bằng chứng tự động rằng mỗi commit/tag đều chạy build, test, audit và nội dung npm được publish trực tiếp từ CI có OIDC provenance.

Khuyến nghị:

1. Thêm workflow CI chạy `npm ci`, `npm test`, `npm run build` và `npm audit`.
2. Dùng npm trusted publishing từ GitHub Actions; bật provenance cho bản phát hành.
3. Chỉ publish từ protected tag/release và clean checkout.
4. Thêm kiểm tra `npm pack --dry-run` hoặc kiểm thử tarball trong CI.

Không nên thêm `prepublishOnly` chỉ để “làm đẹp điểm” nếu quy trình phát hành chưa thống nhất. Publish từ CI có kiểm soát và provenance có giá trị bảo đảm cao hơn.

### R-03 — Bus factor của npm maintainer bằng 1

Mức độ: Medium về vận hành chuỗi cung ứng.

Metadata npm hiện chỉ có:

- `nhannvt <nhannvt09cntt@gmail.com>`

Một tài khoản duy nhất vừa là điểm lỗi đơn vừa là mục tiêu takeover có giá trị cao. Đây là tín hiệu maintenance/supply-chain độc lập với chất lượng source code.

Khuyến nghị:

1. Bắt buộc 2FA cho publish và thay đổi quyền.
2. Dùng trusted publishing để giảm phụ thuộc token npm dài hạn.
3. Cân nhắc thêm ít nhất một maintainer dự phòng đã xác minh, với quy trình review rõ ràng.
4. Không chia sẻ token cá nhân; thu hồi token publish thủ công khi đã chuyển sang OIDC.

### R-04 — Package còn quá mới và độ phổ biến thấp

Mức độ: Informational, không sửa được bằng thay đổi code.

Package được tạo ngày 2026-07-23 và đã phát hành bảy version đến 2026-07-29. Package mới, ít download/star và lịch sử bảo trì ngắn thường bị giảm điểm Maintenance/Quality/Supply Chain theo công thức Socket.

Khuyến nghị:

- duy trì release cadence ổn định;
- tránh bump version dồn dập nếu không cần thiết;
- dùng changelog, tag và GitHub Release nhất quán;
- chờ dữ liệu sử dụng và lịch sử bảo trì tích lũy tự nhiên.

Không nên tạo download, star, maintainer hoặc release giả để tăng điểm.

### R-05 — Network/filesystem capability là có thật nhưng phù hợp chức năng

Mức độ: Informational.

Static analysis có thể phát hiện:

- network access trong client/conformance và script IANA;
- DNS access qua `node:dns`;
- filesystem access trong validator, conformance output và scaffold;
- dynamic `require` qua `createRequire` để load JSON schema.

Các capability này phù hợp với chức năng công bố của package:

- client cần fetch AADP document;
- validator cần đọc schema đi kèm;
- conformance CLI có tùy chọn ghi report;
- scaffold CLI cần tạo file.

Đây không phải dấu hiệu mã độc. Source còn có các kiểm soát tốt:

- chặn SSRF bằng URL policy;
- kiểm tra và pin DNS để chống DNS rebinding;
- kiểm tra từng redirect;
- loại header mặc định khi redirect khác origin;
- giới hạn timeout, redirect và kích thước response;
- scaffold không overwrite nếu thiếu `--force`;
- không có install lifecycle hook.

Khuyến nghị:

1. Giữ các capability có chủ đích và tài liệu hóa rõ.
2. Không cố che hoặc obfuscate chúng để tăng điểm.
3. Cân nhắc bỏ `scripts/check-iana-ipv6-allowlist.mjs` khỏi tarball nếu script chỉ dành cho maintainer. Hiện `package.json:75` chủ động publish cả thư mục `scripts`, khiến artifact có thêm một network-capable file không cần cho runtime chính.
4. Trước khi bỏ script phải xác nhận đây không phải public maintenance utility mà consumer đang sử dụng.

### R-06 — Dependency tree nhỏ và hiện không có CVE

Mức độ: Positive.

Production dependencies:

- `ajv`;
- `ajv-formats`;
- `commander`;
- `undici`.

Production tree chỉ có 9 package và `npm audit` không báo vulnerability. Không có dependency lấy trực tiếp từ Git/GitHub/HTTP, không có wildcard dependency, không có bundled dependency và lockfile có integrity.

Các range dùng caret là SemVer range thông thường, không phải wildcard. Không có căn cứ đổi sang exact version chỉ vì điểm 77; thay đổi policy versioning cần cân nhắc khả năng nhận patch bảo mật và tính tái lập của ứng dụng tiêu thụ.

## Đánh giá source code bảo mật

Không tìm thấy finding Critical hoặc High trong lần review này.

Các điểm mạnh đáng ghi nhận:

- SSRF boundary được triển khai tập trung trong `src/client/http.ts` và `src/client/url-policy.ts`;
- DNS rebinding được xử lý bằng resolve-then-pin trong `src/client/dns-pin.ts`;
- body được đọc theo stream và chặn vượt giới hạn;
- timeout bao phủ cả body read;
- redirect được follow thủ công và kiểm tra policy từng hop;
- credential/header không tự động đi qua cross-origin;
- checksum dùng `node:crypto`;
- JSON schema được đóng gói nội bộ, không tải động từ mạng;
- CLI không gọi shell hoặc thực thi code tải về;
- scaffold validate resource type trước khi tạo tên file.

Một hardening nhỏ có thể xem xét ở đợt riêng: public API `fetchJson` chưa validate rõ ràng các option số như `timeoutMs`, `maxRedirects`, `maxResponseBytes` trước khi request. Giá trị âm/không hữu hạn chủ yếu gây hành vi lỗi hoặc timeout bất ngờ, chưa tạo thành lỗ hổng đã chứng minh. Nếu sửa nên thêm helper validate dùng chung và test; không cần gộp vào công việc tăng điểm metadata.

## Thứ tự xử lý đề xuất

1. Thêm `LICENSE`.
2. Thêm CI bắt buộc cho build/test/audit/package verification.
3. Chuyển publish sang npm trusted publishing và provenance.
4. Bật 2FA, thiết lập maintainer dự phòng và bảo vệ branch/tag.
5. Quyết định có thật sự cần publish thư mục `scripts`.
6. Sau bản release kế tiếp, chờ Socket quét lại rồi lấy breakdown shallow/deep để so sánh.

## Tiêu chí kỳ vọng sau khi xử lý

Không thể cam kết một con số Socket cụ thể vì thuật toán, popularity và tuổi package nằm ngoài source code. Kết quả mong đợi thực tế:

- License artifact đầy đủ;
- release có provenance xác minh được;
- CI công khai và tái lập;
- giảm rủi ro takeover tài khoản;
- tarball chỉ chứa file cần thiết;
- giữ nguyên 0 vulnerability và toàn bộ test pass.
