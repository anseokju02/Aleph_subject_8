import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  base64url, CHALLENGE_COOKIE, cookie, cookieHeader, createSession,
  currentSession, database, expectedSite, fromBase64url, isOwnerPlatformUser,
  json, readBody, reject, sameOrigin, SESSION_COOKIE, writeAudit,
} from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

type PasskeyRow = {
  id: string; name: string; public_key: string; counter: number;
  transports: string; device_type: string; backed_up: number; created_at: number;
};
type ChallengeRow = {
  challenge: string; purpose: string; context: string; name: string | null; expires_at: number;
};

const challengeCookieClear = (request: Request) =>
  cookieHeader(request, CHALLENGE_COOKIE, "", 0);

async function passkeys(): Promise<PasskeyRow[]> {
  const rows = await database().prepare(
    "SELECT id, name, public_key, counter, transports, device_type, backed_up, created_at FROM passkeys ORDER BY created_at",
  ).all<PasskeyRow>();
  return rows.results;
}

async function consumeChallenge(request: Request, purpose: string): Promise<ChallengeRow | null> {
  const id = cookie(request, CHALLENGE_COOKIE);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  // DELETE ... RETURNING makes a question single-use even if verification fails.
  const row = await database().prepare(
    "DELETE FROM challenges WHERE id = ? RETURNING challenge, purpose, context, name, expires_at",
  ).bind(id).first<ChallengeRow>();
  if (!row || row.purpose !== purpose || row.expires_at <= Date.now()) return null;
  return row;
}

async function rememberChallenge(
  request: Request, challenge: string, purpose: string, context: string, name: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  const db = database();
  await db.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(Date.now()).run();
  await db.prepare(
    "INSERT INTO challenges (id, challenge, purpose, context, name, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, challenge, purpose, context, name, Date.now() + 5 * 60_000).run();
  return cookieHeader(request, CHALLENGE_COOKIE, id, 300);
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    const keys = await passkeys();
    return json(session
      ? {
          authenticated: true,
          registered: true,
          passkeys: keys.map(({ id, name, created_at }) => ({ id, name, createdAt: created_at })),
        }
      : {
          authenticated: false,
          registered: keys.length > 0,
          canBootstrap: keys.length === 0 && isOwnerPlatformUser(request),
        },
    );
  } catch {
    return reject("상태를 읽을 수 없습니다.", 500);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reject("같은 출처의 요청만 허용됩니다.", 403);
  const body = await readBody(request);
  if (!body || typeof body.action !== "string") return reject("요청 형식을 확인하세요.", 400);
  try {
    const { origin, rpID } = expectedSite(request);
    const db = database();
    const action = body.action;

    if (action === "register-options") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 40) return reject("패스키 이름은 2~40자로 적어 주세요.", 400);
      const keys = await passkeys();
      const session = await currentSession(request);
      const context = keys.length === 0 && isOwnerPlatformUser(request)
        ? "bootstrap"
        : session?.token_hash;
      if (!context) return reject("첫 등록은 사이트 소유자 확인, 추가 등록은 패스키 로그인이 필요합니다.", 403);
      const options = await generateRegistrationOptions({
        rpName: "Seok Ju 비공개 공간",
        rpID,
        userID: new TextEncoder().encode("seokju-persona-owner"),
        userName: "Seok Ju",
        userDisplayName: "Seok Ju",
        attestationType: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        supportedAlgorithmIDs: [-7, -257],
        excludeCredentials: keys.map(({ id, transports }) => ({
          id, transports: JSON.parse(transports) as string[],
        })),
      });
      const setCookie = await rememberChallenge(request, options.challenge, "register", context, name);
      await writeAudit("register", "question", "새 등록 질문 발급");
      return json({ options }, 200, [setCookie]);
    }

    if (action === "register-verify") {
      const pending = await consumeChallenge(request, "register");
      if (!pending) {
        await writeAudit("register", "rejected", "등록 질문 없음·만료·재사용");
        return reject("등록 질문이 없거나 만료되었습니다. 다시 시작해 주세요.", 403);
      }
      const session = await currentSession(request);
      const keys = await passkeys();
      if (
        pending.context === "bootstrap"
          ? keys.length !== 0 || !isOwnerPlatformUser(request)
          : !session || pending.context !== session.token_hash
      ) return reject("등록 권한이 없습니다.", 403);
      try {
        const verification = await verifyRegistrationResponse({
          response: body.response as RegistrationResponseJSON,
          expectedChallenge: pending.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
        if (!verification.verified) throw new Error("Not verified");
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        await db.prepare(
          `INSERT INTO passkeys (id, name, public_key, counter, transports, device_type, backed_up, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          credential.id, pending.name, base64url(credential.publicKey),
          credential.counter, JSON.stringify(credential.transports ?? []),
          credentialDeviceType, credentialBackedUp ? 1 : 0, Date.now(),
        ).run();
        if (keys.length === 0) {
          const samples = [
            ["project", "준비 중인 프로젝트 메모"],
            ["applications", "지원할 곳 목록"],
            ["reflection", "스스로 쓰는 회고"],
          ];
          for (const [id, title] of samples) {
            await db.prepare(
              "INSERT OR IGNORE INTO private_notes (id, title, body, updated_at) VALUES (?, ?, '', ?)",
            ).bind(id, title, Date.now()).run();
          }
        }
        const sessionCookie = await createSession(credential.id, request);
        await writeAudit("register", "success", "서명 확인 뒤 공개키 저장");
        return json({ verified: true }, 200, [challengeCookieClear(request), sessionCookie]);
      } catch {
        await writeAudit("register", "rejected", "등록 응답 검증 실패");
        return reject("등록 서명을 확인하지 못했습니다. 다시 시작해 주세요.", 403);
      }
    }

    if (action === "login-options") {
      const keys = await passkeys();
      if (keys.length === 0) return reject("등록된 패스키가 없습니다. 소유자가 먼저 등록해야 합니다.", 409);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
        allowCredentials: keys.map(({ id, transports }) => ({
          id, transports: JSON.parse(transports) as string[],
        })),
      });
      const setCookie = await rememberChallenge(request, options.challenge, "login", "owner", null);
      await writeAudit("login", "question", "새 로그인 질문 발급");
      return json({ options }, 200, [setCookie]);
    }

    if (action === "login-verify") {
      const pending = await consumeChallenge(request, "login");
      if (!pending) {
        await writeAudit("login", "rejected", "로그인 질문 없음·만료·재사용");
        return reject("로그인 질문이 없거나 이미 사용되었습니다. 다시 시작해 주세요.", 403);
      }
      const response = body.response as AuthenticationResponseJSON | undefined;
      const key = response && typeof response.id === "string"
        ? await db.prepare(
            "SELECT id, name, public_key, counter, transports, device_type, backed_up, created_at FROM passkeys WHERE id = ?",
          ).bind(response.id).first<PasskeyRow>()
        : null;
      if (!key) {
        await writeAudit("login", "rejected", "등록되지 않은 패스키");
        return reject("등록되지 않은 패스키입니다.", 403);
      }
      try {
        const verification = await verifyAuthenticationResponse({
          response: response!,
          expectedChallenge: pending.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: key.id,
            publicKey: fromBase64url(key.public_key),
            counter: key.counter,
            transports: JSON.parse(key.transports) as string[],
          },
        });
        if (!verification.verified) throw new Error("Not verified");
        await db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?")
          .bind(verification.authenticationInfo.newCounter, key.id).run();
        const sessionCookie = await createSession(key.id, request);
        await writeAudit("login", "success", "새 질문에 대한 서명 검증");
        return json({ verified: true }, 200, [challengeCookieClear(request), sessionCookie]);
      } catch {
        await writeAudit("login", "rejected", "서명·출처·질문 검증 실패");
        return reject("패스키 로그인을 확인하지 못했습니다. 다시 시도해 주세요.", 403);
      }
    }

    if (action === "logout") {
      const token = cookie(request, SESSION_COOKIE);
      if (token) {
        const session = await currentSession(request);
        if (session) await db.prepare("DELETE FROM sessions WHERE token_hash = ?")
          .bind(session.token_hash).run();
      }
      await writeAudit("logout", "success", "서버 세션 폐기");
      return json({ ok: true }, 200, [cookieHeader(request, SESSION_COOKIE, "", 0)]);
    }

    if (action === "delete-passkey") {
      const session = await currentSession(request);
      if (!session) return reject("패스키 로그인이 필요합니다.", 401);
      const id = body.id;
      if (typeof id !== "string") return reject("패스키를 선택해 주세요.", 400);
      const present = await db.prepare("SELECT id FROM passkeys WHERE id = ?").bind(id).first();
      if (!present) return reject("이미 삭제되었거나 없는 패스키입니다.", 404);
      await db.prepare("DELETE FROM passkeys WHERE id = ?").bind(id).run();
      await db.prepare("DELETE FROM sessions WHERE credential_id = ?").bind(id).run();
      await writeAudit("delete", "success", "패스키 삭제; 다른 등록 패스키는 유지");
      return json({ ok: true, remaining: (await passkeys()).length });
    }

    return reject("지원하지 않는 작업입니다.", 400);
  } catch {
    return reject("요청을 처리하지 못했습니다.", 500);
  }
}
