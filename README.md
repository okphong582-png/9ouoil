# Support Mizze

Bot hỗ trợ trong chat riêng: /start, tra key hoặc TK | MK, copy riêng từng ô,
tra lỗi đủ thiết bị và reset có xác nhận. Key còn hiệu lực mới được reset.
Reset giữ hạn/first-use/mật khẩu, dùng chung quota hai lượt/ngày với portal.
Tra cứu không kích hoạt key và không bắt đầu tính hạn.

Bot sửa cùng một tin menu, lưu ID menu qua lần chạy khác và xóa tin người dùng
vừa gửi. Telegram có giới hạn xóa tin nhắn; bot không thể quét/xóa toàn bộ lịch
sử không biết ID hoặc cam kết xóa tin ngoài giới hạn API.

## Chạy tự động

GitHub Actions chạy worker 18.000 giây (~5 giờ), giải phóng lease rồi dispatch
worker mới. Lịch mỗi giờ kiểm tra khởi động khi worker chết. Firebase lease
ngăn hai worker cùng long-poll một token. Giữ nguyên offset và ID menu qua các
runner. GitHub có thể xếp hàng/trễ lịch, không đảm bảo chuyển giao không gián đoạn.

Secrets bắt buộc: TELEGRAM_BOT_TOKEN, FIREBASE_CONFIG_JSON, BOT_VAULT_KEY.
Không commit cấu hình .private, khóa giải mã hoặc tài khoản service-account.

FIREBASE_CONFIG_JSON chỉ chứa FIREBASE_PROJECT_ID/FIREBASE_DATABASE_URL/
FIREBASE_SERVICE_ACCOUNT_JSON và ba trường tương ứng có tiền tố LEGACY_.
Mỗi mật khẩu trong licenseAdminV9/vault được AES-GCM giải mã và kiểm tra lại
hash cặp trước khi trả khách. Key chỉ lưu hash, không có vault, cần gửi TK | MK.

## Dữ liệu vận hành

licensesV9/licenseAdminV9: nguồn key đang có, không tạo hay gia hạn key.
_mizzeSupportV1: lease, offset, menu IDs và snapshot mã hóa trước mỗi reset.
Không lưu mật khẩu khách trong menu-state, log hoặc artifact Actions.
Chạy trên PC dùng backup ZIP trong thư mục backups đã cấu hình; chạy Actions
lưu snapshot được mã hóa trong Firebase và đọc/giải mã kiểm tra trước reset.

Giữ token và khóa vault riêng tư. Bot coi key đầy đủ là thông tin xác minh
quyền sở hữu, chỉ trả thông tin trong chính chat riêng người gửi key.

`npm ci --ignore-scripts` → `npm test` → `npm start`.
