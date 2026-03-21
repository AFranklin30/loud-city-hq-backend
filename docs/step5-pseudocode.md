Loud City HQ — NFC Stamp System
Step 5: API Pseudocode
OKC Thunder  |  Thunder Innovations  |  Confidential

RECEIVE — what comes in
GUARD — checks before work
EXECUTE — reads and writes
RETURN — what goes back


Fan Endpoints
1. POST /fan/registerStart
POST
/fan/registerStart
Actor
Fan — scanned QR code, entered name, email, and kids count
RECEIVE
name         fan typed their full name
email        fan typed their email address
kidsCount    integer 0-3, how many kids in group
GUARD
VALIDATE email is valid format
IF invalid → 400 invalid email format

VALIDATE kidsCount is between 0 and 3
IF out of range → 400 invalid kids count

SET emailLower = lowercase(email)

READ emailIndex/{emailLower}
IF document exists → 400 email already registered
EXECUTE
GENERATE accountId = new UUID

WRITE accounts/{accountId}
  emailLower      = emailLower
  name            = name
  verified        = false
  profileCount    = 0
  activeCardCount = 0
  lastIssuanceAt  = null
  createdAt       = now

WRITE emailIndex/{emailLower}
  accountId = accountId
  createdAt = now

SEND OTP to email
IF send fails → 500 failed to send OTP
RETURN
200  { ok: true }
400  invalid email format
400  invalid kids count
400  email already registered
500  failed to send OTP



2. POST /fan/verifyEmail
POST
/fan/verifyEmail
Actor
Fan — received OTP in email, entered 6-digit code into PWA
RECEIVE
email    same email used at registration
code     6-digit OTP from inbox
GUARD
SET emailLower = lowercase(email)

READ emailIndex/{emailLower}
IF not found → 404 account not found

READ accounts/{accountId}
  accountId pulled from emailIndex record

CHECK stored OTP matches code
IF no match → 400 invalid OTP code

CHECK OTP has not expired
IF expired → 400 OTP code expired
EXECUTE
UPDATE accounts/{accountId}
  verified = true
RETURN
200  { accountId }
     PWA stores accountId for next call
404  account not found
400  invalid OTP code
400  OTP code expired
500  server error



3. POST /fan/createProfilesAndIssuance
POST
/fan/createProfilesAndIssuance
Actor
Fan — entered adult name and kid nicknames, submitted to request cards
RECEIVE
accountId    stored by PWA from verifyEmail response
adultName    fan's own name
kids         array of kid nicknames e.g. ["Kid 1", "Kid 2"]
             empty array if no kids
GUARD
READ accounts/{accountId}
IF not found → 404 account not found

IF account.verified = false → 400 account not verified

CALCULATE totalProfiles = 1 + length(kids)
IF totalProfiles > 4 → 400 exceeds max 4 profiles

IF account.activeCardCount >= 4 → 400 card limit reached

IF account.lastIssuanceAt is not null
AND now - account.lastIssuanceAt < cooldown window
  → 400 please wait before requesting more cards
EXECUTE
GENERATE issuanceId = new UUID

CREATE adult profile
  profileId   = new UUID
  accountId   = accountId
  issuanceId  = issuanceId
  type        = 'adult'
  displayName = adultName
  stamps      = {}
  redeemed    = false
  redeemedAt  = null
  createdAt   = now

FOR each kid in kids array
  CREATE kid profile
    profileId   = new UUID
    accountId   = accountId
    issuanceId  = issuanceId
    type        = 'kid'
    displayName = kid nickname
    stamps      = {}
    redeemed    = false
    redeemedAt  = null
    createdAt   = now

WRITE issuances/{issuanceId}
  accountId    = accountId
  profileIds   = array of all profileIds
  profileCount = totalProfiles
  expiresAt    = now + 30 minutes
  used         = false
  createdAt    = now

WRITE all profile docs to profiles collection

UPDATE accounts/{accountId}
  profileCount   += totalProfiles
  lastIssuanceAt  = now
RETURN
200  { issuanceId }
404  account not found
400  account not verified
400  exceeds max 4 profiles
400  card limit reached
400  cooldown active
500  server error



4. GET /fan/issuance/:issuanceId
GET
/fan/issuance/:issuanceId
Actor
Fan — confirmation screen showing pickup QR code for staff to scan
RECEIVE
:issuanceId    URL path parameter — no request body
GUARD
READ issuances/{issuanceId}
IF not found → 404 issuance not found
EXECUTE
READ profiles WHERE issuanceId = issuanceId
  returns array of profile docs

BUILD response
  issuanceId   = issuanceId
  status       = issuance.used ? 'used' : 'pending'
  expiresAt    = issuance.expiresAt
  profileCount = issuance.profileCount
  profiles     = [{ profileId, displayName, type }]

NOTE: no writes — pure read endpoint
RETURN
200  { issuanceId, status, expiresAt,
       profileCount, profiles[] }
     PWA renders issuanceId as QR code
404  issuance not found
500  server error



5. GET /t/:token
GET
/t/:token
Actor
Fan — tapped NFC card on phone, browser opened progress page
RECEIVE
:token    URL path parameter parsed from NFC card URL
          fan never typed this — card stores full URL
GUARD
READ cards WHERE token = token
IF not found → 404 token not found

IF card.active = false → 400 card inactive

READ profiles WHERE profileId = card.profileId
IF not found → 404 profile not found

NOTE: public endpoint — no auth required
      rate limit by IP
      never return email — displayName only
EXECUTE
READ stations to get totalStations count

CALCULATE completedCount
  completedCount = COUNT of keys in profile.stamps

BUILD response
  displayName   = profile.displayName
  stamps        = profile.stamps
  redeemed      = profile.redeemed
  totalStations = totalStations
  completed     = completedCount

NOTE: no writes — pure read endpoint
RETURN
200  { displayName, stamps, redeemed,
       totalStations, completed }
404  token not found
404  profile not found
400  card inactive
500  server error



Staff Endpoints
6. POST /staff/issueCard
POST
/staff/issueCard
Actor
Staff — selecting one profile from issuance to write NFC card. Called once per profile.
RECEIVE
issuanceId    scanned from fan QR code
profileId     selected from profile list on screen

NOTE: Firebase Auth token required in header
GUARD
VALIDATE staff Firebase Auth token
IF invalid → 401 unauthorized

READ issuances/{issuanceId}
IF not found → 404 issuance not found

IF issuance.expiresAt < now → 400 issuance expired

IF issuance.used = true → 400 issuance already used

CHECK profileId in issuance.profileIds array
IF not found → 400 profile not in this issuance

READ cards WHERE profileId = profileId
IF card exists → 400 card already issued for profile

READ accounts/{issuance.accountId}
IF activeCardCount >= 4 → 400 card limit reached
EXECUTE
GENERATE token = random 128-bit UUID

WRITE cards/{token}
  token      = generated token
  accountId  = issuance.accountId
  profileId  = profileId
  active     = true
  issuedAt   = now
  returnedAt = null

UPDATE accounts/{issuance.accountId}
  activeCardCount += 1

BUILD tokenUrl
  tokenUrl = 'https://tap.domain.com/t/' + token

IF all profiles in issuance now have cards
  UPDATE issuances/{issuanceId}
    used = true
RETURN
200  { tokenUrl }
     staff NFC writer burns tokenUrl to card
401  unauthorized
404  issuance not found
400  issuance expired
400  issuance already used
400  profile not in issuance
400  card already issued
400  card limit reached
500  server error



7. POST /staff/redeem
POST
/staff/redeem
Actor
Staff — fan handed in card, staff taps it to complete redemption and award prize
RECEIVE
token    staff taps physical NFC card to read token

NOTE: Firebase Auth token required in header
GUARD
VALIDATE staff Firebase Auth token
IF invalid → 401 unauthorized

READ cards WHERE token = token
IF not found → 404 card not found

IF card.active = false → 400 card already inactive

READ profiles WHERE profileId = card.profileId
IF not found → 404 profile not found

IF profile.redeemed = true → 400 already redeemed

READ stations to get totalStations count
CALCULATE completedCount = COUNT keys in profile.stamps

IF completedCount < totalStations
  → 400 stamp card incomplete
       return how many stamps are missing
EXECUTE
UPDATE profiles/{card.profileId}
  redeemed   = true
  redeemedAt = now

UPDATE cards/{token}
  active     = false
  returnedAt = now

UPDATE accounts/{card.accountId}
  activeCardCount -= 1
RETURN
200  { redeemed: true,
       displayName,
       stamps }
401  unauthorized
404  card not found
404  profile not found
400  card already inactive
400  already redeemed
400  stamp card incomplete
500  server error



8. POST /staff/manualStamp
POST
/staff/manualStamp
Actor
Staff — admin override tool for station outages. Still enforces duplicate prevention.
RECEIVE
token       staff scans or enters card token
stationId   which station to manually award

NOTE: Firebase Auth token required — admin only
GUARD
VALIDATE staff Firebase Auth token
IF invalid → 401 unauthorized

READ cards WHERE token = token
IF not found → 404 card not found

IF card.active = false → 400 card not active

READ profiles WHERE profileId = card.profileId
IF not found → 404 profile not found

IF profile.redeemed = true → 400 already redeemed

READ stations WHERE stationId = stationId
IF not found → 404 station not found

IF stationId EXISTS in profile.stamps map
  → 400 stamp already exists for this station
EXECUTE
UPDATE profiles.stamps map
  stamps[stationId] = now

WRITE stampEvents/{stampEventId}
  stampEventId = new UUID
  profileId    = card.profileId
  stationId    = stationId
  token        = token
  result       = 'success'
  deviceId     = 'manual'
  ts           = now
RETURN
200  { ok: true, stamps: updated stamps map }
401  unauthorized
404  card not found
404  profile not found
404  station not found
400  card not active
400  already redeemed
400  duplicate stamp
500  server error



Station Endpoints
9. POST /station/stamp
POST
/station/stamp
Actor
Station device — fan tapped NFC card at a stamp station
RECEIVE
Header: X-Station-Key   secret key for this station device
Body:
  token       read from NFC card by station device
  stationId   which station this device is
  deviceId    which physical device (for audit trail)
GUARD
VALIDATE X-Station-Key against stations collection
IF invalid → 401 unauthorized

READ cards WHERE token = token
IF not found
  WRITE stampEvent result = 'error'
  → 404 token not found

IF card.active = false
  WRITE stampEvent result = 'inactive'
  → 400 card not active

READ stations WHERE stationId = stationId
IF not found
  WRITE stampEvent result = 'error'
  → 404 station not found

IF station.active = false
  WRITE stampEvent result = 'inactive'
  → 400 station not active

READ profiles WHERE profileId = card.profileId

IF profile.redeemed = true
  WRITE stampEvent result = 'redeemed'
  → 400 profile already redeemed

IF stationId EXISTS in profile.stamps map
  WRITE stampEvent result = 'duplicate'
  → 400 duplicate stamp

NOTE: guard order is intentional — cheapest first
NOTE: stampEvent written on every failure for audit trail
EXECUTE
WRITE profiles.stamps map
  stamps[stationId] = now
  USE Firestore transaction to prevent race condition
  two stations cannot stamp same profile simultaneously

WRITE stampEvents/{stampEventId}
  stampEventId = new UUID
  profileId    = card.profileId
  stationId    = stationId
  token        = token
  tokenHash    = hash of token
  result       = 'success'
  deviceId     = deviceId
  ts           = now

CALCULATE stampsCompletedCount
  COUNT keys in updated stamps map

CALCULATE totalStations
  COUNT active stations
RETURN
200 success
  { result: 'success',
    stampsCompletedCount,
    totalStations }

200 business failure (not a crash)
  { result: 'duplicate' | 'inactive'
           | 'redeemed' | 'error',
    message: human readable reason }

NOTE: returns 200 even on business failures
      station UI needs clean response to show fan

401  invalid station key
404  token not found
404  station not found
500  server error



Loud City HQ  |  Step 5 Pseudocode  |  Thunder Innovations  |  Confidential
