# DmCare Inbox — ระบบรวมแชท LINE (a1–a5) & Facebook (b1–b5)

ระบบรวมแชทหลายร้านค้าสำหรับทีมแอดมิน **DmCare** รองรับ **LINE Official Accounts (`a1–a5`)** และ **Facebook Pages (`b1–b5`)** ในหน้าจอเดียวแบบ Real-time พร้อม **Login & RBAC แยกสิทธิ์รายร้าน**, **AI Vision ตรวจหลักฐานกิจกรรม (เกณฑ์ ≥ 90% ไม่ Fraud)**, **คลังโค้ด Gift Voucher `.xls` (`1 code / 1 time`)**, **PostgreSQL (`FOR UPDATE SKIP LOCKED`)** และ **Cloudflare R2**

- รันทดสอบในเครื่องได้ทันทีด้วย **Node.js 22+ & SQLite (WAL mode)**
- พร้อม Deploy ขึ้น Production (**GitHub + Railway + PostgreSQL + Cloudflare R2**) อ่านคู่มือฉบับมือใหม่ได้ที่ [docs/DEPLOY_GUIDE_TH.md](docs/DEPLOY_GUIDE_TH.md)

---

## วิธีรันในเครื่อง (Local Dev)

```bash
cp .env.example .env
npm run dev
```

เปิดเบราว์เซอร์ไปที่ `http://127.0.0.1:3000` แล้ว Login ด้วยบัญชีเริ่มต้น (โหมด Dev):
- **Supervisor (เห็นทุกร้าน + จัดการทีม & `.xls`):** `may@shop.local` / `admin1234`
- **Agent (เห็นเฉพาะ `a1–a3`, `b1–b3`):** `ton@shop.local` / `agent1234`
- **Agent (เห็นเฉพาะ `a4–a5`, `b4–b5`):** `fah@shop.local` / `agent1234`

## รัน Automated Tests

```bash
npm test
```

## ขึ้น Production จริง (Cloud 24/7 สำหรับ ~500K ข้อความ/เดือน)

1. อ่านคู่มือทีละขั้นที่ **[docs/DEPLOY_GUIDE_TH.md](docs/DEPLOY_GUIDE_TH.md)**
2. ระบบจะสลับโหมดอัตโนมัติเมื่อตั้งค่า Environment Variables บน Railway:
   - `DATABASE_URL` → สลับจาก SQLite เป็น **PostgreSQL** (`FOR UPDATE SKIP LOCKED`)
   - `R2_*` → สลับการเก็บรูปภาพจาก Local Disk เป็น **Cloudflare R2** (Egress \$0)
   - `NODE_ENV=production` → ซ่อนปุ่ม Simulator, ซ่อนบัญชีทดสอบหน้า Login และบล็อก `/api/simulator/inbound`
3. ตรวจสอบสถานะระบบได้ที่ `GET /health`
