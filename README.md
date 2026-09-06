# SDS Management — Google Apps Script + GitHub Pages

ชุดนี้แปลงแดชบอร์ด `SDS.html` ให้ใช้ Google Sheet เป็นฐานข้อมูลกลาง และใช้ Google Drive เก็บไฟล์ PDF ของ SDS ส่วนหน้าเว็บสาธารณะอยู่ใน `docs/` สำหรับเผยแพร่ด้วย GitHub Pages

## โครงสร้าง

- `apps-script/Code.gs` — Google Apps Script backend, Google Sheet, Google Drive และ API
- `apps-script/Index.html` — หน้า admin สำหรับเพิ่ม/แก้ไข/ลบข้อมูลผ่าน Apps Script
- `appsscript.json` — manifest ของ Apps Script
- `docs/index.html` — หน้าเว็บสำหรับ GitHub Pages
- `docs/config.js` — URL ของ Apps Script API

## 1) ตั้งค่า Google Apps Script

1. เปิด [script.google.com](https://script.google.com) แล้วสร้างโปรเจกต์ใหม่
2. สร้างไฟล์ `Code.gs` และ `Index.html` แล้วคัดลอกไฟล์จากโฟลเดอร์ `apps-script/` ไปวาง
3. เปิด Project Settings แล้วเปิด `Show "appsscript.json" manifest file in editor` จากนั้นแทนที่ manifest ด้วยไฟล์ `appsscript.json` ในชุดนี้
4. เลือกฟังก์ชัน `setupSystem` แล้วกด Run หนึ่งครั้ง จากนั้นอนุญาตสิทธิ์ Google Sheets และ Google Drive
5. ถ้าต้องการกำหนดผู้ดูแลหลายคน ให้ไปที่ Project Settings > Script properties แล้วตั้งค่า `ADMIN_EMAILS` เป็นอีเมลคั่นด้วย comma เช่น `name@example.com,admin@example.com`
6. Deploy > New deployment > Web app แล้วตั้งค่าให้ทำงานในบัญชีเจ้าของสคริปต์ และเปิดให้ผู้ใช้ที่ต้องการเข้าถึงได้
7. คัดลอก URL ที่ลงท้ายด้วย `/exec`

หน้า Apps Script จะเป็นหน้าสำหรับผู้ดูแลระบบ ส่วนการอ่านข้อมูลสาธารณะใช้ endpoint เดียวกันโดยเติม `action=api` ซึ่งหน้า GitHub จะเรียกให้อัตโนมัติ

## 2) เชื่อมต่อหน้า GitHub Pages

แก้ไฟล์ `docs/config.js`:

```js
window.SDS_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  adminUrl: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  publicReadOnly: true
};
```

เมื่อ `publicReadOnly: true` คนทั่วไปจะดู ค้นหา กรอง และ export CSV ได้ แต่จะไม่เห็นปุ่มเพิ่ม/แก้ไข/ลบ ข้อมูลที่บันทึกจะมาจาก Google Sheet แบบกลาง

## 3) นำขึ้น GitHub

สร้าง repository แบบ Public แล้วรันคำสั่งจากโฟลเดอร์ชุดนี้:

```powershell
git init
git add .
git commit -m "Build SDS management website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

จากนั้นเปิด GitHub repository > Settings > Pages:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

URL ที่คนอื่นใช้เปิดจะเป็น `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`

## หมายเหตุด้านสิทธิ์และข้อมูล

- หน้า GitHub เป็นโหมดอ่านอย่างเดียวโดยตั้งใจ เพื่อไม่ให้ผู้ชมทั่วไปลบหรือแก้ข้อมูลใน Sheet
- การเพิ่ม/แก้ไข/ลบจากหน้า Apps Script จะตรวจสอบอีเมลใน `ADMIN_EMAILS`
- PDF ที่อัปโหลดจะพยายามตั้งเป็น `Anyone with the link / Viewer` เพื่อให้ผู้ชมเปิดจาก GitHub ได้ หากองค์กรปิดการแชร์แบบนี้ ผู้ชมจะเห็นข้อมูลรายการแต่เปิด PDF ไม่ได้
- อย่าใส่ข้อมูล SDS ที่เป็นความลับหรือข้อมูลส่วนบุคคลใน deployment ที่เปิดสาธารณะ
- GitHub Pages ไม่สามารถรัน `google.script.run` ได้โดยตรง จึงใช้ Apps Script เป็น backend/API แยกจากหน้าเว็บ GitHub
