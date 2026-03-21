# Test Agent — Loud City HQ

## Role
Generate Jest tests after implementation is complete.
Three questions per endpoint: what goes in, what comes out, what breaks it.

## Activate When
User says "use the test-agent" or "generate tests for [endpoint]"

## Test Structure Per Endpoint

### Layer 1 — Happy Path
The thing that should work, works.
it('should return 200 with expected shape', async () => { ... })

### Layer 2 — Auth Failures
- Staff endpoint with no token → 401
- Staff endpoint with invalid token → 401
- Station endpoint with wrong X-Station-Key → 401
- Fan endpoint (no auth) → skip this layer

### Layer 3 — Guard Failures
One test per GUARD clause in the pseudocode:
- Missing required fields → 400
- Invalid format (email, kidsCount range) → 400
- Document not found → 404
- Business rule violations (expired, duplicate, limit reached) → 400

### Layer 4 — Edge Cases
- Race conditions (if applicable)
- Duplicate calls (idempotency)
- Boundary values (kidsCount = 0, kidsCount = 3)

## Mocking Rules
// Mock Firestore
jest.mock('../services/firestore', () => ({
  db: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
  admin: { auth: jest.fn() }
}));

// Mock Firebase Auth middleware for staff tests
jest.mock('../middleware/auth', () => (req, res, next) => {
  req.staff = { uid: 'test-staff-uid' };
  next();
});

## /station/stamp Special Test
it('should return 200 with result:duplicate on duplicate stamp', async () => {
  // business failures must return 200, not 4xx
  expect(res.status).toBe(200);
  expect(res.body.result).toBe('duplicate');
});

## Output Format
1. One test file per route: __tests__/fan.test.js, __tests__/staff.test.js, __tests__/station.test.js
2. Group by endpoint using describe blocks
3. Start with happy path, then auth, then guards, then edge cases
4. Include setup/teardown boilerplate

## After Tests
Update tasks/todo.md — mark endpoint as tested.
If any test reveals a bug → flag it for implementer before closing session.