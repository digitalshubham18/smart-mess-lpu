# Testing the meal scanner on real phones (10 minutes)

The scanner logic is covered by automated tests, but a camera can only be tested on a real device. Do this once on the
**https** deployment (not http) before the first real meal service.

## You need
- The deployed site on **https://** (browsers refuse cameras on plain http; `localhost` is fine for a laptop test).
- A counter login (Kitchen Staff) and a student login on a second phone (or use a printed ID card).
- One **iPhone (Safari)** and one **Android phone (Chrome)** as the counter device. Also try Firefox once if anyone uses it.

## On each counter device
1. Sign in as counter staff → **Attendance** → under *Scan* tap **Check this device**.
   - Secure page ✔, Camera available ✔, Camera permission ✔ (allow it when asked).
   - It says which decoder it uses: *built-in* (Chrome/Edge) or *bundled JavaScript* (iPhone Safari, Firefox). Both are fine.
2. Tap **Try a real read** and point it at any QR code. You should see "This device can scan". Nobody is checked in.

## End-to-end, with a student phone
1. Student: sign in → **Attendance**. A QR with a countdown appears and renews itself.
2. Counter: choose the meal being served → the camera opens → scan the student's QR.
   - Expect: a green flash, a rising double beep, the student's **photo, name, UID, hostel/room, meal, date and time**.
3. Scan the **same** QR again → refused ("already checked in").
4. Take a **screenshot** of the QR, wait 70 seconds, scan the screenshot → refused ("expired — screenshots don't work").
5. Choose a meal that is **not** being served → camera stays off and the screen says why.
6. Type a UID by hand → it works and the result card says "UID typed by counter staff".
7. Turn the phone's data off, scan a QR → told it can't be verified offline; type the UID instead → "Saved offline", then turn data on and watch it sync.

## Printed ID card (no phone / temporary ID)
1. Students page → the QR icon on a student's row → **Print card**. Scan it at the counter → "printed ID card scanned".
2. **Reissue** the card, scan the old printout → refused ("no longer valid").

## Push notifications (needs https)
1. Student phone: Attendance → **Notify this device** → *Turn on notifications* → allow. Tap **Send a test** → a notification appears.
   - **iPhone:** first Share → *Add to Home Screen*, open the app from the Home Screen, then do this step.
2. **Close the browser/app completely**, check the student in from the counter → the phone shows *"Lunch check-in recorded"* on the lock screen.
3. Tap the notification → the Attendance page opens.
4. Manager phone: Attendance → *Scan alerts* → **Alert this device**. Present a made-up QR at the counter → *"Suspicious meal scan"* arrives (and only one, however many you try within 10 minutes).
5. Sign out on the student phone, check that student in again → **nothing** arrives on that phone.

## If something fails
- No notification on Android → Settings → Apps → the browser → Notifications must be allowed; battery saver can delay it.
- Camera won't open → the page is not https, or camera permission is blocked for the site (check the browser's site settings).
- Slow scanning on an older iPhone → hold the phone steady ~20 cm away; make sure the student's screen brightness is high.
- Wrong meal / "not meal time" → check the clock and the meal timings (Attendance → Edit meal timings, managers only).

## Offline meal code (no data at the counter)

Needs a real phone, HTTPS, and a counter device. Not yet verified on hardware.

1. On the student's phone, sign in and open **Attendance** with internet. Under the QR you should see "Also works with no internet on this phone."
2. Turn on **airplane mode**. Reload the page: it must still open (service-worker app shell). If you get a browser error page, the service worker did not install — check you are on https and have opened the site online at least twice.
3. The card shows an **amber "Offline code"** QR with a countdown, and it changes every minute.
4. Scan it at the counter (counter online): the student is checked in. Scan the **same** screen again within the minute: refused as already used.
5. Put the **counter** in airplane mode too and scan an offline code: it shows "Saved offline … not confirmed yet". Restore the connection: the scan syncs, or appears under rejected scans with the reason.
6. On the phone, **Profile → Devices → Sign out everywhere**, then try step 4 with a screenshot of an old offline code: it must be refused.
7. Sign out and in again on the phone while online and confirm a fresh offline code works (the old key is replaced).
