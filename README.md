# 3-Bot Round-Robin Counter (Webhook / Render)

این پروژه یک بات کنترل‌کننده (Bot1) دارد و پیام‌های شمارنده را نوبتی بین 3 بات ارسال می‌کند:

1 → Bot1  
2 → Bot2  
3 → Bot3  
4 → Bot1  
...

## قابلیت‌ها
- دکمه‌ها:
  - ▶️ استارت
  - ⏹ پایان
- شمارش 1..1000 + نوشتن عدد به حروف فارسی
- تنظیم فاصله:
  - `/interval 2`
  - `/interval 0.5`
- Webhook-ready برای Render Free

## فایل‌ها
- `main.py` : اپ اصلی (Webhook + Engine)
- `render.yaml` : تنظیمات Render Blueprint

## اجرا لوکال (اختیاری)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export BOT_TOKEN_1="TOKEN_CONTROLLER"
export BOT_TOKEN_2="TOKEN_SENDER2"
export BOT_TOKEN_3="TOKEN_SENDER3"
export PUBLIC_URL="https://your-service.onrender.com"

python main.py
```

## Deploy روی Render (Free)
1) ریپو را روی GitHub push کنید.
2) Render → New → Web Service یا Blueprint
3) Build Command:
`pip install -r requirements.txt`
4) Start Command:
`python main.py`
5) ENV Vars:
- `BOT_TOKEN_1`
- `BOT_TOKEN_2`
- `BOT_TOKEN_3`
- `PUBLIC_URL` (مثلاً https://xxx.onrender.com)
- اختیاری:
  - `DEFAULT_INTERVAL_SECONDS` (پیش‌فرض 1)
  - `MAX_COUNT` (پیش‌فرض 1000)

Webhook به صورت خودکار روی:
`{PUBLIC_URL}/telegram/webhook`
ست می‌شود.

## نکته Render Free
سرویس ممکن است Sleep شود و شمارنده وسط کار قطع شود (به خاطر in-memory state).
برای پایداری کامل باید state را در DB/Redis ذخیره کنید.
