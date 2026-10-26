$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001'
$tmp = Join-Path $env:TEMP 'his_test'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$script:pass = 0; $script:fail = 0
function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Host "[PASS] $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "[FAIL] $name $detail" -ForegroundColor Red }
}
function Count($v) { @($v | Where-Object { $null -ne $_ }).Count }
function Login($email, $pw = 'demo123') {
  try {
    $s = $null
    Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -ContentType 'application/json' `
      -Body (@{email = $email; password = $pw} | ConvertTo-Json) -SessionVariable s -ErrorAction Stop | Out-Null
    return $s
  } catch { return $null }
}
function J($sess, $method, $path, $body) {
  try {
    if ($null -ne $body) {
      $r = Invoke-WebRequest -Uri "$base$path" -Method $method -WebSession $sess -ContentType 'application/json' `
        -Body ($body | ConvertTo-Json -Depth 8) -UseBasicParsing
    } else {
      $r = Invoke-WebRequest -Uri "$base$path" -Method $method -WebSession $sess -UseBasicParsing
    }
    $j = $null; try { $j = $r.Content | ConvertFrom-Json } catch {}
    return @{ code = [int]$r.StatusCode; json = $j }
  } catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $txt = ''
    if ($resp) {
      try { $txt = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
    }
    $j = $null; try { $j = $txt | ConvertFrom-Json } catch {}
    return @{ code = $code; json = $j; text = $txt }
  }
}

Write-Host "`n=== 0. HEALTH & PAGES ===" -ForegroundColor Cyan
$h = J $null GET '/api/health'
Check 'health endpoint' ($h.code -eq 200)
$pages = @('/', '/login', '/dashboard', '/patients', '/doctors', '/appointments', '/records', '/labs', '/prescriptions', '/billing', '/reports', '/admin')
foreach ($p in $pages) {
  $r = J $null GET $p
  Check "page $p renders" ($r.code -eq 200)
}

Write-Host "`n=== 1. AUTH ===" -ForegroundColor Cyan
$admin  = Login 'admin@demo.local'
$doctor = Login 'priya@demo.local'
$pat    = Login 'aarav@demo.local'
$lab    = Login 'lab@demo.local'
$recep  = Login 'reception@demo.local'
Check 'admin login' ($null -ne $admin)
Check 'doctor login' ($null -ne $doctor)
Check 'patient login' ($null -ne $pat)
Check 'lab login' ($null -ne $lab)
Check 'receptionist login' ($null -ne $recep)
$bad = J $null POST '/api/auth/login' @{email = 'admin@demo.local'; password = 'wrong'}
Check 'wrong password rejected (401)' ($bad.code -eq 401)
$me = J $admin GET '/api/auth/me'
Check 'me returns admin role' ($me.code -eq 200 -and $me.json.user.role -eq 'admin')

Write-Host "`n=== 2. DASHBOARD ===" -ForegroundColor Cyan
foreach ($pair in @(@('admin',$admin), @('doctor',$doctor), @('patient',$pat), @('lab',$lab), @('receptionist',$recep))) {
  $d = J $pair[1] GET '/api/dashboard'
  Check "dashboard for $($pair[0])" ($d.code -eq 200 -and (Count $d.json.kpis) -gt 0)
}

Write-Host "`n=== 3. PATIENTS ===" -ForegroundColor Cyan
$pl = J $admin GET '/api/patients'
Check 'admin lists patients' ($pl.code -eq 200 -and (Count $pl.json.patients) -ge 8)
$pl2 = J $pat GET '/api/patients'
Check 'patient list scoped to own record only' ($pl2.code -eq 200 -and (Count $pl2.json.patients) -eq 1 -and $pl2.json.patients[0].id -eq 1)
$uniq = Get-Random -Minimum 10000 -Maximum 99999
$newp = J $recep POST '/api/patients' @{name = 'Smoke Tester'; dob = "1990-0$($uniq % 7 + 1)-15"; gender = 'Male'; phone = "+91 9$uniq 00001"; email = "smoke$uniq@test.local"; address = 'Test St'; blood_group = 'O+'}
Check 'receptionist creates patient' ($newp.code -eq 201 -and $null -ne $newp.json.patient.id)
$dup = J $recep POST '/api/patients' @{name = 'Smoke Tester'; dob = $newp.json.patient.dob; gender = 'Male'; phone = $newp.json.patient.phone}
Check 'duplicate registration rejected (409)' ($dup.code -eq 409)
$newp2 = J $pat POST '/api/patients' @{name = 'X Y'; dob = '1990-01-01'; gender = 'Male'}
Check 'patient role blocked from creating (403)' ($newp2.code -eq 403)
$badp = J $recep POST '/api/patients' @{name = ''; dob = 'not-a-date'; gender = 'Other'; phone = 'xx'}
Check 'invalid patient rejected (400 + error)' ($badp.code -eq 400 -and $badp.json.error)
$ptid = $newp.json.patient.id
$pd = J $admin GET "/api/patients/$ptid"
Check 'admin fetches patient detail' ($pd.code -eq 200 -and $pd.json.patient.name -eq 'Smoke Tester')
$pdSelf = J $pat GET '/api/patients/1'
Check 'patient views own record (200)' ($pdSelf.code -eq 200)
$pdOther = J $pat GET '/api/patients/2'
Check 'patient blocked from other record (403)' ($pdOther.code -eq 403)
$pdRecep = J $recep GET '/api/patients/1'
Check 'receptionist sees no clinical records (privacy)' ($pdRecep.code -eq 200 -and (Count $pdRecep.json.patient.records) -eq 0)
$pupd = J $recep PUT "/api/patients/$ptid" @{address = '99 Test Avenue'}
Check 'receptionist updates patient' ($pupd.code -eq 200 -and $pupd.json.patient.address -eq '99 Test Avenue')
$pupd2 = J $pat PUT '/api/patients/1' @{address = 'hacked'}
Check 'patient blocked from editing profile (403)' ($pupd2.code -eq 403)

Write-Host "`n=== 4. DOCTORS & SLOTS ===" -ForegroundColor Cyan
$dl = J $admin GET '/api/doctors'
Check 'admin lists doctors' ($dl.code -eq 200 -and (Count $dl.json.doctors) -ge 5)
$dl2 = J $pat GET '/api/doctors'
Check 'patient lists doctors (view allowed)' ($dl2.code -eq 200 -and (Count $dl2.json.doctors) -ge 5)
$dd = J $pat GET '/api/doctors/1'
Check 'doctor detail with stats + permissions' ($dd.code -eq 200 -and $null -ne $dd.json.stats -and $dd.json.permissions.canEdit -eq $false)
$docPut = J $doctor PUT '/api/doctors/1' @{phone = '+91 98200 22001'}
Check 'doctor edits own profile' ($docPut.code -eq 200)
$docPut2 = J $doctor PUT '/api/doctors/2' @{phone = '+91 98200 22999'}
Check 'doctor blocked from other profile (403)' ($docPut2.code -eq 403)
$docNew = J $doctor POST '/api/doctors' @{name = 'Dr. Nobody'; specialization = 'Test'; fee = 100}
Check 'non-admin blocked from adding doctor (403)' ($docNew.code -eq 403)
$badDoc = J $admin POST '/api/doctors' @{name = 'Dr. X'; specialization = ''; fee = 'abc'}
Check 'invalid doctor rejected (400)' ($badDoc.code -eq 400 -and $badDoc.json.error)

# find the first open day (within a week) where the doctor actually has slots
$slotDate = $null; $slots = $null
for ($off = 1; $off -le 7; $off++) {
  $tryDate = (Get-Date).AddDays($off).ToString('yyyy-MM-dd')
  $r = J $recep GET "/api/slots?doctorId=1&date=$tryDate"
  if ($r.code -eq 200 -and (Count $r.json.slots) -gt 0) { $slotDate = $tryDate; $slots = $r; break }
}
Check 'slot grid returned for an open day' ($null -ne $slots -and (Count $slots.json.slots) -gt 0)
$badSlots = J $recep GET '/api/slots?doctorId=1&date=2000-01-01'
Check 'past date slots rejected (400)' ($badSlots.code -eq 400)

Write-Host "`n=== 5. APPOINTMENTS (conflict-free) ===" -ForegroundColor Cyan
$freeSlot = $slots.json.slots | Where-Object { $_.available } | Select-Object -First 1
Check 'a free slot exists' ($null -ne $freeSlot)
$a1 = J $recep POST '/api/appointments' @{patientId = $ptid; doctorId = 1; date = $slotDate; time = $freeSlot.time; reason = 'Smoke visit'}
Check 'receptionist books appointment (201)' ($a1.code -eq 201 -and $null -ne $a1.json.appointment.id)
$a2 = J $recep POST '/api/appointments' @{patientId = 2; doctorId = 1; date = $slotDate; time = $freeSlot.time; reason = 'Conflict attempt'}
Check 'double-booking same slot blocked (409)' ($a2.code -eq 409)
Check 'conflict message names the slot' ($a2.json.error -match 'already has a booking')
$a3 = J $pat POST '/api/appointments' @{patientId = 2; doctorId = 1; date = $slotDate; time = '12:00'; reason = 'x'}
Check 'patient blocked from booking for others (403)' ($a3.code -eq 403)
$aid = $a1.json.appointment.id
$slotsAfter = J $recep GET "/api/slots?doctorId=1&date=$slotDate"
$stillFree = $slotsAfter.json.slots | Where-Object { $_.time -eq $freeSlot.time } | Select-Object -First 1
Check 'booked slot no longer available' ($stillFree.available -eq $false)
$badDate = J $recep POST '/api/appointments' @{patientId = $ptid; doctorId = 1; date = '2000-01-01'; time = '10:00'}
Check 'booking in past rejected (400)' ($badDate.code -eq 400)
$badTime = J $recep POST '/api/appointments' @{patientId = $ptid; doctorId = 1; date = $slotDate; time = '25:99'}
Check 'invalid time rejected (400)' ($badTime.code -eq 400)

# patient books for themselves
$myFree = $slotsAfter.json.slots | Where-Object { $_.available } | Select-Object -First 1
$a4 = J $pat POST '/api/appointments' @{doctorId = 1; date = $slotDate; time = $myFree.time; reason = 'Patient self-booking'}
Check 'patient books own appointment (201)' ($a4.code -eq 201)
$aid4 = $a4.json.appointment.id
$byPat = J $pat PUT "/api/appointments/$aid4" @{status = 'completed'}
Check 'patient cannot mark completed (403 rights)' ($byPat.code -eq 403)
$crossPat = J $pat PUT "/api/appointments/$aid" @{status = 'cancelled'}
Check 'patient blocked from other patient appt (403)' ($crossPat.code -eq 403)
$labAppt = J $lab PUT "/api/appointments/$aid" @{status = 'cancelled'}
Check 'lab staff blocked from appointments (403)' ($labAppt.code -eq 403)
$futureComplete = J $recep PUT "/api/appointments/$aid" @{status = 'completed'}
Check 'future appointment cannot be completed (400)' ($futureComplete.code -eq 400)
$cancel = J $recep PUT "/api/appointments/$aid" @{status = 'cancelled'}
Check 'receptionist cancels appointment' ($cancel.code -eq 200 -and $cancel.json.appointment.status -eq 'cancelled')
# complete a due (today-or-earlier) scheduled appointment.
# Self-heal: each smoke run consumes one due appointment from the seed pool,
# so when the pool is empty we first book one for today in a free slot, and
# after hours (no same-day slot left) we revive a past appointment instead.
$todayStr = (Get-Date).ToString('yyyy-MM-dd')
$todays = J $admin GET ('/api/appointments?status=scheduled&to=' + $todayStr)
$mineToday = $todays.json.appointments | Where-Object { $_.date -le $todayStr } | Select-Object -First 1
if (-not $mineToday) {
  for ($docId = 1; $docId -le 5 -and -not $mineToday; $docId++) {
    $sl = J $recep GET "/api/slots?doctorId=$docId&date=$todayStr&patientId=$ptid"
    $free = $null
    if ($sl.code -eq 200) { $free = $sl.json.slots | Where-Object { $_.available } | Select-Object -First 1 }
    if ($free) {
      $bk = J $recep POST '/api/appointments' @{patientId = $ptid; doctorId = $docId; date = $todayStr; time = $free.time; reason = 'Smoke self-heal visit'}
      if ($bk.code -eq 201) { $mineToday = $bk.json.appointment }
    }
  }
}
if (-not $mineToday) {
  # after hours: no same-day slot remains — revive any past non-scheduled appointment
  $past = J $admin GET ('/api/appointments?status=all&to=' + $todayStr)
  $cand = $past.json.appointments | Where-Object { $_.date -le $todayStr -and $_.status -ne 'scheduled' } | Select-Object -First 1
  if ($cand) {
    $rev = J $admin PUT "/api/appointments/$($cand.id)" @{status = 'scheduled'}
    if ($rev.code -eq 200) { $mineToday = $rev.json.appointment }
  }
}
Check 'a scheduled appointment today or earlier exists' ($null -ne $mineToday)
if ($mineToday) {
  $done = J $admin PUT "/api/appointments/$($mineToday.id)" @{status = 'completed'}
  Check 'completing a due appointment works (200)' ($done.code -eq 200 -and $done.json.appointment.status -eq 'completed')
}
$apptView = J $pat GET "/api/appointments/$aid4"
Check 'patient views own appointment detail' ($apptView.code -eq 200)
$apptView2 = J $pat GET "/api/appointments/$aid"
Check 'patient blocked from other appointment detail (403)' ($apptView2.code -eq 403)

Write-Host "`n=== 6. MEDICAL RECORDS ===" -ForegroundColor Cyan
$rl = J $doctor GET '/api/records'
Check 'doctor lists records' ($rl.code -eq 200 -and (Count $rl.json.records) -ge 8)
$rl2 = J $recep GET '/api/records'
Check 'receptionist blocked from records (403)' ($rl2.code -eq 403)
$rl3 = J $lab GET '/api/records'
Check 'lab staff blocked from records (403)' ($rl3.code -eq 403)
$rl4 = J $pat GET '/api/records'
Check 'patient lists own records (200)' ($rl4.code -eq 200)
$rec = J $doctor POST '/api/records' @{patientId = $ptid; visitDate = (Get-Date).ToString('yyyy-MM-dd'); diagnosis = 'Smoke diagnosis'; treatment = 'Rest and fluids'; notes = 'automated test'}
Check 'doctor creates record (201)' ($rec.code -eq 201 -and $null -ne $rec.json.record.id)
$badRec = J $doctor POST '/api/records' @{patientId = $ptid; diagnosis = ''}
Check 'record without diagnosis rejected (400)' ($badRec.code -eq 400 -and $badRec.json.error)
$futRec = J $doctor POST '/api/records' @{patientId = $ptid; visitDate = '2099-01-01'; diagnosis = 'Future visit'}
Check 'future-dated record rejected (400)' ($futRec.code -eq 400)
$rec2 = J $recep POST '/api/records' @{patientId = $ptid; diagnosis = 'x'}
Check 'receptionist blocked from creating record (403)' ($rec2.code -eq 403)
$recId = $rec.json.record.id
$recUpd = J $doctor PUT "/api/records/$recId" @{treatment = 'Updated treatment plan'}
Check 'doctor updates own record (200 + audit trail fields)' ($recUpd.code -eq 200 -and $recUpd.json.record.updated_by_name)
$recUpd2 = J $pat PUT "/api/records/$recId" @{treatment = 'self edit'}
Check 'patient blocked from editing records (403)' ($recUpd2.code -eq 403)

Write-Host "`n=== 7. LABORATORY ===" -ForegroundColor Cyan
$ll = J $lab GET '/api/labs'
Check 'lab staff lists tests' ($ll.code -eq 200 -and (Count $ll.json.lab_tests) -ge 10 -and $null -ne $ll.json.counts)
$ll2 = J $pat GET '/api/labs'
Check 'patient lab list scoped to own (200)' ($ll2.code -eq 200)
$badStatus = J $lab GET '/api/labs?status=bogus'
Check 'invalid lab status filter rejected (400)' ($badStatus.code -eq 400)
$lo = J $doctor POST '/api/labs' @{patientId = $ptid; testName = 'CBC'; category = 'Hematology'; notes = 'smoke'}
Check 'doctor orders lab test (201)' ($lo.code -eq 201 -and $null -ne $lo.json.lab_test.id)
$lid = $lo.json.lab_test.id
$badLab = J $doctor POST '/api/labs' @{patientId = $ptid; testName = ''}
Check 'empty test name rejected (400)' ($badLab.code -eq 400)
$lr2 = J $doctor PUT "/api/labs/$lid" @{status = 'completed'; result = 'hack'}
Check 'doctor cannot enter lab results (403)' ($lr2.code -eq 403)
$premature = J $lab PUT "/api/labs/$lid" @{status = 'completed'}
Check 'completion without result rejected (400)' ($premature.code -eq 400)
$lr = J $lab PUT "/api/labs/$lid" @{status = 'completed'; result = 'WBC 7.2 /uL; Hb 14.1 g/dL'; referenceRange = 'WBC 4-11'}
Check 'lab staff records result (200)' ($lr.code -eq 200 -and $lr.json.lab_test.status -eq 'completed')
$lrEmpty = J $lab PUT "/api/labs/$lid" @{status = 'in_progress'; result = ''}
Check 'clearing result allowed for re-run (200)' ($lrEmpty.code -eq 200)
$lrDone = J $lab PUT "/api/labs/$lid" @{status = 'completed'; result = 'WBC 7.2 /uL; Hb 14.1 g/dL'}
Check 'lab test completed again' ($lrDone.code -eq 200)

Write-Host "`n=== 8. FILE UPLOAD (type + size checks) ===" -ForegroundColor Cyan
$pngPath = Join-Path $tmp 'result.png'
[IO.File]::WriteAllBytes($pngPath, [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + (New-Object byte[] 64))
$exePath = Join-Path $tmp 'evil.exe'
[IO.File]::WriteAllBytes($exePath, [Text.Encoding]::ASCII.GetBytes('MZ fake binary'))
$bigPath = Join-Path $tmp 'big.pdf'
[IO.File]::WriteAllBytes($bigPath, (New-Object byte[] (6MB)))
$ck = $lab.Cookies.GetCookies([Uri]$base)['his_session'].Value
$up1 = curl.exe -s -o NUL -w '%{http_code}' -X PUT -H "Cookie: his_session=$ck" -F "file=@$pngPath;type=image/png" "$base/api/labs/$lid"
Check 'valid PNG upload accepted (200)' ($up1 -eq '200')
$up2 = curl.exe -s -o NUL -w '%{http_code}' -X PUT -H "Cookie: his_session=$ck" -F "file=@$exePath;type=application/octet-stream" "$base/api/labs/$lid"
Check 'EXE upload rejected (400)' ($up2 -eq '400')
$up3 = curl.exe -s -o NUL -w '%{http_code}' -X PUT -H "Cookie: his_session=$ck" -F "file=@$bigPath;type=application/pdf" "$base/api/labs/$lid"
Check 'oversized file rejected (400)' ($up3 -eq '400')
$dck = $doctor.Cookies.GetCookies([Uri]$base)['his_session'].Value
$up4 = curl.exe -s -o NUL -w '%{http_code}' -X PUT -H "Cookie: his_session=$dck" -F "file=@$pngPath" "$base/api/labs/$lid"
Check 'doctor blocked from uploading results (403)' ($up4 -eq '403')
$dlOk = J $lab GET "/api/files/lab/$lid"
Check 'lab staff downloads uploaded file (200)' ($dlOk.code -eq 200)
$rck = $recep.Cookies.GetCookies([Uri]$base)['his_session'].Value
$dlNo = curl.exe -s -o NUL -w '%{http_code}' -H "Cookie: his_session=$rck" "$base/api/files/lab/$lid"
Check 'receptionist blocked from file download (403)' ($dlNo -eq '403')

Write-Host "`n=== 9. PRESCRIPTIONS ===" -ForegroundColor Cyan
$rx = J $doctor POST '/api/prescriptions' @{patientId = $ptid; appointmentId = $aid; diagnosis = 'Smoke diagnosis'; medicines = @(@{name = 'Amoxicillin'; strength = '500mg'; dosage = '1 capsule'; frequency = 'TID'; duration = '5 days'; notes = 'after food'}); instructions = 'Complete the course'}
Check 'doctor writes prescription (201)' ($rx.code -eq 201 -and $null -ne $rx.json.prescription.id)
Check 'medicine rows persisted' ((Count $rx.json.prescription.medicines) -eq 1 -and $rx.json.prescription.medicines[0].name -eq 'Amoxicillin')
$badRx = J $doctor POST '/api/prescriptions' @{patientId = $ptid; diagnosis = 'x'; medicines = @()}
Check 'prescription without medicines rejected (400)' ($badRx.code -eq 400 -and $badRx.json.error)
$badRx2 = J $doctor POST '/api/prescriptions' @{patientId = $ptid; diagnosis = 'x'; medicines = @(@{name = ''})}
Check 'medicine without name rejected (400)' ($badRx2.code -eq 400)
$rx2 = J $recep POST '/api/prescriptions' @{patientId = $ptid; diagnosis = 'x'; medicines = @(@{name = 'Vit'})}
Check 'receptionist blocked from prescriptions (403)' ($rx2.code -eq 403)
$rxl = J $pat GET '/api/prescriptions'
Check 'patient sees own prescriptions (200)' ($rxl.code -eq 200)
$rxl2 = J $recep GET '/api/prescriptions'
Check 'receptionist blocked from prescription list (403)' ($rxl2.code -eq 403)
$rxId = $rx.json.prescription.id
$rxUpd = J $doctor PUT "/api/prescriptions/$rxId" @{status = 'completed'}
Check 'doctor updates prescription status (200)' ($rxUpd.code -eq 200 -and $rxUpd.json.prescription.status -eq 'completed')

Write-Host "`n=== 10. BILLING ===" -ForegroundColor Cyan
$inv = J $recep POST '/api/invoices' @{patientId = $ptid; items = @(@{description = 'Consultation'; amount = 500; qty = 1}, @{description = 'CBC Test'; amount = 300; qty = 1})}
Check 'receptionist creates invoice (201)' ($inv.code -eq 201 -and $null -ne $inv.json.invoice.id)
Check 'invoice total computed server-side (800)' ([math]::Abs($inv.json.invoice.total - 800) -lt 0.01)
$badInv = J $recep POST '/api/invoices' @{patientId = $ptid; items = @()}
Check 'invoice without items rejected (400)' ($badInv.code -eq 400 -and $badInv.json.error)
$badInv2 = J $recep POST '/api/invoices' @{patientId = $ptid; items = @(@{description = 'X'; amount = 100; qty = 1}); discount = 5000}
Check 'discount > subtotal rejected (400)' ($badInv2.code -eq 400)
$invid = $inv.json.invoice.id
$invDoc = J $doctor GET '/api/invoices'
Check 'doctor blocked from billing list (403)' ($invDoc.code -eq 403)
$invPat = J $pat GET '/api/invoices'
Check 'patient sees own invoices (200)' ($invPat.code -eq 200)
$pay = J $recep POST '/api/payments' @{invoiceId = $invid; amount = 400; method = 'cash'}
Check 'partial payment recorded (201)' ($pay.code -eq 201 -and $pay.json.invoice.status -eq 'partial')
Check 'balance is 400 after partial payment' ([math]::Abs($pay.json.invoice.balance - 400) -lt 0.01)
$payOver = J $recep POST '/api/payments' @{invoiceId = $invid; amount = 9999; method = 'cash'}
Check 'over-payment rejected (400)' ($payOver.code -eq 400)
$payBadMethod = J $recep POST '/api/payments' @{invoiceId = $invid; amount = 10; method = 'bitcoin'}
Check 'invalid payment method rejected (400)' ($payBadMethod.code -eq 400)
$pay2 = J $recep POST '/api/payments' @{invoiceId = $invid; amount = 400; method = 'upi'}
Check 'balance cleared, invoice marked paid' ($pay2.code -eq 201 -and $pay2.json.invoice.status -eq 'paid' -and [math]::Abs($pay2.json.invoice.balance) -lt 0.01)
$pay3 = J $recep POST '/api/payments' @{invoiceId = $invid; amount = 10; method = 'cash'}
Check 'payment on fully paid invoice rejected (400)' ($pay3.code -eq 400)
$payPat = J $pat POST '/api/payments' @{invoiceId = $invid; amount = 10; method = 'cash'}
Check 'patient blocked from payments (403)' ($payPat.code -eq 403)
$invDetail = J $recep GET "/api/invoices/$invid"
Check 'invoice detail shows paid status + payments' ($invDetail.code -eq 200 -and $invDetail.json.invoice.status -eq 'paid')
$payList = J $recep GET '/api/payments'
Check 'transaction history listed' ($payList.code -eq 200 -and (Count $payList.json.payments) -gt 0)
$payListPat = J $pat GET '/api/payments'
Check 'patient blocked from transaction ledger (403)' ($payListPat.code -eq 403)

Write-Host "`n=== 11. REPORTS ===" -ForegroundColor Cyan
$rep = J $admin GET '/api/reports?days=90'
Check 'admin views reports' ($rep.code -eq 200 -and $null -ne $rep.json.billing.billed -and $null -ne $rep.json.appointments.byStatus)
Check 'report period echoed back' ($rep.json.period.days -eq 90)
$rep2 = J $pat GET '/api/reports?days=90'
Check 'patient blocked from reports (403)' ($rep2.code -eq 403)
$rep3 = J $doctor GET '/api/reports?days=365'
Check 'doctor views reports' ($rep3.code -eq 200 -and $rep3.json.period.days -eq 365)
$rep4 = J $recep GET '/api/reports?days=30'
Check 'receptionist views reports' ($rep4.code -eq 200)

Write-Host "`n=== 12. ADMIN ===" -ForegroundColor Cyan
$au = J $admin GET '/api/admin/users'
Check 'admin lists users' ($au.code -eq 200 -and (Count $au.json.users) -ge 9 -and $null -ne $au.json.selfId)
$au2 = J $recep GET '/api/admin/users'
Check 'receptionist blocked from admin users (403)' ($au2.code -eq 403)
$au3 = J $pat GET '/api/admin/users'
Check 'patient blocked from admin users (403)' ($au3.code -eq 403)
$nu = J $admin POST '/api/admin/users' @{name = 'Smoke User'; email = "smoke$uniq@user.local"; password = 'secret123'; role = 'receptionist'}
Check 'admin creates user (201)' ($nu.code -eq 201 -and $null -ne $nu.json.user.id -and $null -eq $nu.json.user.password_hash)
$nuBad = J $admin POST '/api/admin/users' @{name = 'Bad Mail'; email = 'not-an-email'; password = 'secret123'; role = 'receptionist'}
Check 'invalid email rejected (400)' ($nuBad.code -eq 400)
$nuRole = J $admin POST '/api/admin/users' @{name = 'Wiz Kid'; email = "wiz$uniq@test.local"; password = 'secret123'; role = 'wizard'}
Check 'invalid role rejected (400)' ($nuRole.code -eq 400 -and $nuRole.json.error -match 'role')
$nuDup = J $admin POST '/api/admin/users' @{name = 'Dup'; email = 'admin@demo.local'; password = 'secret123'; role = 'receptionist'}
Check 'duplicate email rejected (409)' ($nuDup.code -eq 409)
$nuShort = J $admin POST '/api/admin/users' @{name = 'Short Pw'; email = "pw$uniq@test.local"; password = '123'; role = 'receptionist'}
Check 'short password rejected (400)' ($nuShort.code -eq 400)
$nu3 = J $recep POST '/api/admin/users' @{name = 'X Y'; email = "x$uniq@test.local"; password = 'secret123'; role = 'receptionist'}
Check 'non-admin blocked from user creation (403)' ($nu3.code -eq 403)

$au4 = J $admin GET '/api/admin/audit'
Check 'audit log listed' ($au4.code -eq 200 -and (Count $au4.json.logs) -gt 0 -and (Count $au4.json.actions) -gt 0)
Check 'login events audited' (@($au4.json.logs | Where-Object { $_.action -eq 'auth.login' }).Count -gt 0)
$auFilter = J $admin GET '/api/admin/audit?action=patient.create'
Check 'audit action filter works' ($auFilter.code -eq 200 -and @($auFilter.json.logs | Where-Object { $_.action -ne 'patient.create' }).Count -eq 0)
$auDoc = J $doctor GET '/api/admin/audit'
Check 'doctor blocked from audit log (403)' ($auDoc.code -eq 403)

$set = J $admin GET '/api/admin/settings'
Check 'admin reads settings' ($set.code -eq 200 -and $set.json.settings.hospital_name)
$set2 = J $admin PUT '/api/admin/settings' @{hospital_name = 'HIS Demo Clinic'; appointment_slot_minutes = 30}
Check 'settings updatable (200)' ($set2.code -eq 200 -and $set2.json.settings.hospital_name -eq 'HIS Demo Clinic')
$setBad = J $admin PUT '/api/admin/settings' @{appointment_slot_minutes = 3}
Check 'invalid slot length rejected (400)' ($setBad.code -eq 400)
$setDoc = J $doctor GET '/api/admin/settings'
Check 'non-admin blocked from settings (403)' ($setDoc.code -eq 403)
$null = J $admin PUT '/api/admin/settings' @{hospital_name = 'MediCore General Hospital'}

Write-Host "`n=== 13. AUDIT OF IMPORTANT CHANGES ===" -ForegroundColor Cyan
$audit = J $admin GET '/api/admin/audit?limit=300'
$acts = @($audit.json.logs | ForEach-Object { $_.action })
$actStr = $acts -join ','
Check 'patient.create audited' ($actStr -match 'patient.create')
Check 'appointment.create audited' ($actStr -match 'appointment.create')
Check 'appointment.update audited' ($actStr -match 'appointment.update')
Check 'record.create audited' ($actStr -match 'record.create')
Check 'lab.result audited' ($actStr -match 'lab.result|lab.upload')
Check 'payment.record audited' ($actStr -match 'payment.record')
Check 'invoice.create audited' ($actStr -match 'invoice.create')
Check 'prescription.create audited' ($actStr -match 'prescription.create')
Check 'user.create audited' ($actStr -match 'user.create')

Write-Host "`n=== 14. UNAUTHENTICATED ACCESS ===" -ForegroundColor Cyan
$un = J $null GET '/api/patients'
Check 'anon blocked from patients (401)' ($un.code -eq 401)
$un2 = J $null GET '/api/dashboard'
Check 'anon blocked from dashboard (401)' ($un2.code -eq 401)
$un3 = J $null GET '/api/admin/users'
Check 'anon blocked from admin (401)' ($un3.code -eq 401)
$un4 = J $null GET '/api/invoices'
Check 'anon blocked from billing (401)' ($un4.code -eq 401)
$un5 = J $null POST '/api/appointments' @{patientId = 1}
Check 'anon cannot book (401)' ($un5.code -eq 401)

Write-Host "`n=== 15. LOGOUT ===" -ForegroundColor Cyan
$out = J $admin POST '/api/auth/logout' @{}
Check 'logout succeeds' ($out.code -eq 200)
$after = J $admin GET '/api/auth/me'
Check 'session invalidated after logout (401)' ($after.code -eq 401)
$after2 = J $admin GET '/api/patients'
Check 'data inaccessible after logout (401)' ($after2.code -eq 401)

Write-Host "`n===============================" -ForegroundColor Cyan
Write-Host "PASS: $script:pass   FAIL: $script:fail" -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
if ($script:fail -gt 0) { exit 1 }
