# SmartCam على Render.com

الملفات دي بتنقل السيرفر (اللي كان على VPS + Nginx + DuckDNS) لـ Render.
Render بيدّيك HTTPS ورابط جاهز، فمش محتاج Nginx ولا Certbot ولا DuckDNS.

```
smartcam-render/
├── package.json     تجهيز مكتبات السيرفر
├── server.js        السيرفر (API + بيخدم لوحة التحكم والصور)
├── public/index.html  لوحة التحكم
├── render.yaml      (اختياري) إعدادات جاهزة لـ Render
└── pi/              كل ملفات الـ Raspberry Pi + سكربت التثبيت
```

## الخطوة 1: ارفع على GitHub
1. اعمل مستودع جديد على GitHub (مثلاً `smartcam`).
2. ارفع كل محتويات المجلد ده فيه (اسحب الملفات في صفحة المستودع → Commit).

## الخطوة 2: انشر على Render
1. Render → **New +** → **Web Service** → اختار المستودع.
2. الإعدادات:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
3. من **Environment** ضيف 3 متغيرات:

| الاسم | القيمة |
|---|---|
| `API_KEY` | أي نص طويل عشوائي (ده مفتاح الـ Pi) |
| `DASH_PASSWORD` | الباسورد اللي هتفتح بيه لوحة التحكم |
| `SHUTDOWN_PIN` | رقم إيقاف الـ Pi |

4. **Create Web Service** وانتظر لحد ما يبقى **Live**، وانسخ الرابط (مثلاً `https://smartcam-xxxx.onrender.com`).

لما تفتح الرابط من المتصفح هيطلب اسم مستخدم وباسورد: اكتب أي اسم، والباسورد هو `DASH_PASSWORD`.

## الخطوة 3: اربط الـ Raspberry Pi
على الـ Pi (SSH):
```
git clone https://github.com/اسمك/smartcam.git
cd smartcam/pi
sudo bash install-pi.sh https://smartcam-xxxx.onrender.com  نفس_قيمة_API_KEY
```
السكربت بيثبّت الحزم، وبيكتب الرابط والمفتاح في `/etc/smartcam.conf`، وبيشغّل كل الخدمات.
لو غيّرت الرابط بعدين، شغّل نفس الأمر تاني بالرابط الجديد.

لو المستودع Private ومش عايز تعمل clone، حمّل مجلد `pi` بأي طريقة (scp أو فلاشة) وشغّل `install-pi.sh` منه.

## اختبار
- افتح الرابط → المفروض تلاقي **Connected** والصورة بتتحدث.
- متابعة الـ Pi: `journalctl -u smartcam-upload-mini.service -f`
- لو ظهر `401 Bad API key`: قيمة `API_KEY` في `/etc/smartcam.conf` مختلفة عن Render.

## حاجات لازم تعرفها (النسخة المجانية)
- **السيرفر بينام بعد 15 دقيقة من غير طلبات.** الـ Pi بيبعت طلبات طول الوقت فهيفضل صاحي، لكن لو الـ Pi اتقفل وفتحت الصفحة هتستنى حوالي دقيقة لحد ما يصحى.
- **الـ disk مؤقت**: آخر لقطة HD بتتمسح لو السيرفر اتعمله Restart أو Deploy. دي حاجة في الخطة المجانية. لو عايز تحتفظ باللقطات، محتاج Persistent Disk (مدفوع) أو تخزين خارجي (مرحلة قادمة).
- الـ ping العادي مش بيشتغل على Render، فقياس الـ Latency وفحص الـ Watchdog بقوا بالـ HTTP.
- لو سبت `API_KEY` أو `DASH_PASSWORD` فاضيين، الحماية بتتقفل وأي حد يعرف الرابط يقدر يدخل.
