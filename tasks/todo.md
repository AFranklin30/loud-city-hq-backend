# Endpoints

## Fan
- [x] POST /fan/registerStart — implemented, tested
- [x] POST /fan/verifyEmail — implemented, tested
- [x] POST /fan/createProfilesAndIssuance — implemented, tested
- [x] GET /fan/issuance/:issuanceId — implemented, tested

## Staff
- [ ] POST /staff/issueCard
- [ ] POST /staff/redeem
- [ ] POST /staff/manualStamp

## Station
- [ ] POST /station/stamp

## Tap
- [ ] GET /t/:token

## TODOs
- [ ] OTP service (stubbed in registerStart)
- [ ] IP rate limiting (fan endpoints)
- [ ] Ask TPM: what should the issuance cooldown window be? (currently hard-coded to 24 hours in createProfilesAndIssuance)
