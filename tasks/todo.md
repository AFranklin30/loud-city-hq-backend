# Endpoints

## Fan
- [x] POST /fan/registerStart — implemented, tested
- [x] POST /fan/verifyEmail — implemented, tested
- [x] POST /fan/createProfilesAndIssuance — implemented, tested
- [x] GET /fan/issuance/:issuanceId — implemented, tested

## Staff
- [x] POST /staff/issueCard — implemented, tested
- [x] POST /staff/redeem — implemented, tested
- [ ] POST /staff/manualStamp

## Station
- [x] POST /station/stamp — implemented, tested

## Tap
- [x] GET /t/:token — implemented, tested

## TODOs
- [ ] OTP service (stubbed in registerStart)
- [ ] IP rate limiting (fan endpoints)
- [ ] Ask TPM: what should the issuance cooldown window be? (currently hard-coded to 24 hours in createProfilesAndIssuance)
