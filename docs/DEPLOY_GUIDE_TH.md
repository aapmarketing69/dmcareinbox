# คู่มือขึ้น Production ระบบ DmCare (ฉบับมือใหม่ ทำตามทีละคลิก)

คู่มือนี้ช่วยให้คุณนำระบบ **DmCare Inbox** ขึ้นเซิร์ฟเวอร์จริงแบบ **24/7** รองรับปริมาณแชท **~500,000 ข้อความ/เดือน** ด้วยชุดเครื่องมือที่ดูแลง่ายและคุ้มค่าที่สุดสำหรับผู้เริ่มต้น:

- **GitHub (Private Repo)** — เก็บโค้ดอย่างปลอดภัย (ฟรี)
- **Cloudflare R2** — เก็บรูปภาพทั้งหมด ค่าดาวน์โหลดออกฟรี (Egress \$0) เริ่มต้นฟรี 10 GB/เดือน
- **Railway + PostgreSQL** — รันเซิร์ฟเวอร์ Node.js + ฐานข้อมูล PostgreSQL พร้อม HTTPS ถาวร (~350–1,000 บาท/เดือน)

---

## ขั้นที่ 1: เตรียมรหัสลับ (Secrets) ไว้ใช้บน Cloud

เปิด Terminal บนเครื่อง Mac แล้วรันคำสั่งนี้เพื่อสร้างรหัสลับแบบสุ่มที่ปลอดภัย (คัดลอกเก็บไว้ใน Notes ก่อน):

```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

> **สำคัญ:** ห้ามนำไฟล์ `.env` หรือรหัสลับเหล่านี้ขึ้น GitHub เด็ดขาด (ไฟล์ `.gitignore` ในโปรเจกต์ตั้งค่าป้องกันไว้ให้แล้ว)

---

## ขั้นที่ 2: อัปโหลดโค้ด DmCare ขึ้น GitHub (Private)

1. สมัครและล็อกอินที่ [github.com](https://github.com)
2. กดปุ่ม **`+` (มุมขวาบน) → New repository**
3. ตั้งชื่อ `dmcare-inbox` → เลือก **Private** (ห้ามเลือก Public) → กด **Create repository**
4. เปิด Terminal แล้วรันคำสั่งต่อไปนี้ทีละบรรทัด (เปลี่ยน `YOUR_USERNAME` เป็นชื่อ GitHub ของคุณ):

```bash
cd /Users/bbspn/.gemini/antigravity/scratch/omnichannel-chat
git init
git add .
git commit -m "Initial DmCare v1 production release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dmcare-inbox.git
git push -u origin main
```

---

## ขั้นที่ 3: สร้างที่เก็บรูปภาพบน Cloudflare R2

1. สมัคร/ล็อกอินที่ [dash.cloudflare.com](https://dash.cloudflare.com)
2. เมนูซ้ายเลือก **R2 Object Storage → Create bucket**
   - ตั้งชื่อ Bucket เช่น `dmcare-media` → เลือก Location `APAC (Asia Pacific)` → กด **Create bucket**
3. เปิดสิทธิ์ให้ LINE / Facebook ดึงรูปภาพไปแสดงได้:
   - เข้าไปใน Bucket `dmcare-media` → แท็บ **Settings** → หัวข้อ **Public Development URL** (หรือเชื่อม Custom Domain เช่น `media.dmcare.app`) → กด **Enable**
   - จดลิงก์ไว้เป็นค่า **`R2_PUBLIC_URL`** (เช่น `https://pub-xxxxxxxx.r2.dev`)
4. สร้าง API Token สำหรับให้เซิร์ฟเวอร์อัปโหลดรูป:
   - กลับไปหน้า **R2 Overview** → มุมขวาบนกด **Manage R2 API Tokens → Create API Token**
   - ตั้งชื่อ `dmcare-server` → Permissions เลือก **Object Read & Write** → เลือกเฉพาะ Bucket `dmcare-media` → กด **Create**
   - จดค่าทั้ง 3 ตัวเก็บไว้:
     - **Account ID** (`R2_ACCOUNT_ID`)
     - **Access Key ID** (`R2_ACCESS_KEY_ID`)
     - **Secret Access Key** (`R2_SECRET_ACCESS_KEY`)

---

## ขั้นที่ 4: เปิดเซิร์ฟเวอร์ + ฐานข้อมูล PostgreSQL บน Railway

1. สมัคร/ล็อกอินที่ [railway.app](https://railway.app) ด้วยบัญชี GitHub ของคุณ
2. กด **New Project → Deploy from GitHub repo** → เลือก `dmcare-inbox`
3. เพิ่มฐานข้อมูล PostgreSQL ในโปรเจกต์เดียวกัน:
   - กด **`+ Create` → Database → Add PostgreSQL**
4. ผูกฐานข้อมูลและตั้งค่า Environment Variables ให้แอป **DmCare**:
   - คลิกที่กล่อง Service `dmcare-inbox` → แท็บ **Variables** → เพิ่มตัวแปรดังนี้:

| ชื่อตัวแปร | ค่าที่ต้องใส่ | หมายเหตุ |
|---|---|---|
| `NODE_ENV` | `production` | ซ่อนปุ่ม Simulator & รหัสทดสอบอัตโนมัติ |
| `BRAND_NAME` | `DmCare` | ชื่อแบรนด์ |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | ดึงจากบริการ PostgreSQL บน Railway อัตโนมัติ |
| `LIVE_DELIVERY_ENABLED` | `true` | เปิดการส่งแชทจริงเข้า LINE / Facebook |
| `ENCRYPTION_KEY` | *(ค่าที่สร้างจากขั้นที่ 1)* | ห้ามเปลี่ยนหลังเริ่มใช้งานจริง |
| `SESSION_SECRET` | *(ค่าที่สร้างจากขั้นที่ 1)* | สำหรับเซ็น Login Cookie |
| `ADMIN_EMAIL` | `owner@dmcare.app` *(อีเมลคุณ)* | บัญชี Supervisor หลักครั้งแรก |
| `ADMIN_PASSWORD` | *(ตั้งรหัสผ่านยาวๆ)* | รหัสผ่านสำหรับเข้าสู่ระบบครั้งแรก |
| `ADMIN_NAME` | `หัวหน้าทีม DmCare` | ชื่อที่แสดงในระบบ |
| `PUBLIC_BASE_URL` | `https://xxxx.up.railway.app` | ดูจากแท็บ Settings → Networking → Generate Domain |
| `R2_ACCOUNT_ID` | *(จากขั้นที่ 3)* | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | *(จากขั้นที่ 3)* | R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | *(จากขั้นที่ 3)* | R2 Secret Access Key |
| `R2_BUCKET` | `dmcare-media` | ชื่อ R2 Bucket |
| `R2_PUBLIC_URL` | `https://pub-xxxx.r2.dev` | ลิงก์ Public ของ R2 Bucket |
| `GEMINI_API_KEY` | *(ไม่บังคับ)* | ใส่เมื่อต้องการเปิด AI ตรวจหลักฐาน (รุ่น Pro) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | โมเดล AI เริ่มต้น |
| `FB_VERIFY_TOKEN` | *(ตั้งเอง เช่น `dmcare_fb_2026`)* | ใช้ตอนเชื่อม Meta App |
| `FB_APP_SECRET` | *(จาก Meta Developers)* | ใช้ตอนเชื่อม Facebook Page |

5. สร้างลิงก์ HTTPS ถาวร:
   - ใน Service `dmcare-inbox` → แท็บ **Settings → Networking → Generate Domain** (หรือผูกโดเมนของคุณเอง เช่น `inbox.dmcare.app`)
   - นำลิงก์ที่ได้ (เช่น `https://dmcare-inbox-production.up.railway.app`) ไปใส่ในตัวแปร **`PUBLIC_BASE_URL`** ด้านบน
6. กดเปิดลิงก์ `https://YOUR-DOMAIN/health` — ถ้าขึ้น JSON ว่า:
   ```json
   { "status": "ok", "brandName": "DmCare", "environment": "production", "dbEngine": "postgres", "storageProvider": "cloudflare-r2" }
   ```
   แปลว่าระบบพร้อมใช้งานจริง 100% แล้ว!

---

## ขั้นที่ 5: ย้าย LINE OA & Facebook มาใช้ลิงก์ถาวรของ DmCare

1. เปิดเว็บ `https://YOUR-DOMAIN` แล้ว Login ด้วย `ADMIN_EMAIL` / `ADMIN_PASSWORD` ที่คุณตั้งไว้
2. กดปุ่ม **`⚙ ตั้งค่าร้าน`** ด้านซ้าย → เลือกร้าน (`a1–a5` สำหรับ LINE, `b1–b5` สำหรับ Facebook) → กด **แก้ Token** แล้ววาง Channel ID, Access Token, Channel Secret จริง → กดบันทึก (ระบบจะเข้ารหัส AES-256-GCM ให้อัตโนมัติ)
3. กด **`📋 คัดลอก URL`** ของร้านนั้น (จะได้รูปแบบ `https://YOUR-DOMAIN/webhooks/line/a1`)
4. นำไปวางใน **LINE Developers Console → Messaging API → Webhook URL** → กด **Verify** → เปิด **Use webhook**
5. กด **`👥 ทีม & สิทธิ์`** เพื่อสร้างบัญชีให้แอดมินแต่ละคน พร้อมติ๊กเลือกร้านที่แต่ละคนมีสิทธิ์ดูแล

---

## เกร็ดสำคัญตอนใช้งานจริง (Operations Tips)

- **ถ้า Gemini AI หนาแน่นชั่วคราว (503):** Supervisor สามารถกดปุ่ม **`🛡 ตรวจเองโดย Supervisor (ไม่ใช้ AI)`** → ระบบจะยังตรวจจับรูปซ้ำ (SHA-256) และสิทธิ์ซ้ำ (1 คน/1 โค้ด) ให้อัตโนมัติ จากนั้นกด **`🛡 Supervisor อนุมัติแจกโค้ด (Manual Override)`** เพื่อแจกโค้ดต่อได้โดยงานไม่สะดุด
- **ไม่ต้องเปิด `cloudflared` บนเครื่อง Mac อีกต่อไป:** เมื่อย้ายขึ้น Railway แล้ว เซิร์ฟเวอร์จะออนไลน์ตลอด 24 ชม. แม้คุณจะปิดเครื่อง Mac
- **ดู Logs และสุขภาพระบบ:** เข้า Railway → Service `dmcare-inbox` → แท็บ **Logs** เพื่อดูข้อความการทำงานแบบ Real-time
