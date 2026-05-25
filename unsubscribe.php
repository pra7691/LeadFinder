<?php
/**
 * Verbose Tech Labs — Unsubscribe Page
 * ─────────────────────────────────────
 * 1. Upload this file to your web hosting via FTP.
 * 2. Change ADMIN_SECRET below to a private password only you know.
 * 3. In LeadFinder → Settings → Email Tracking, set:
 *      Unsubscribe Page URL  →  https://verbosetechlabs.com/unsubscribe.php
 *      Unsubscribe Admin Secret  →  (the same password you set below)
 * 4. Click "Save". LeadFinder will now embed unsubscribe links in every
 *    outgoing email pointing to this page.
 * 5. Use the "Sync Unsubscribes" button in LeadFinder → Unsubscribes to
 *    pull new unsubscribes into your local app.
 */

define('ADMIN_SECRET', 'CHANGE_THIS_TO_A_STRONG_PASSWORD');

// ─── Storage: a JSON file in the same directory ───────────────────────────────
// You can rename this file if you prefer (keep it hidden, e.g. .unsubscribes.json)
define('DATA_FILE', __DIR__ . '/unsubscribes-data.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadData(): array {
    if (!file_exists(DATA_FILE)) return [];
    $raw = file_get_contents(DATA_FILE);
    if (!$raw) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function saveData(array $data): void {
    file_put_contents(DATA_FILE, json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function isUnsubscribed(array $data, string $email): bool {
    $emailLower = strtolower(trim($email));
    foreach ($data as $row) {
        if (strtolower(trim($row['email'] ?? '')) === $emailLower) return true;
    }
    return false;
}

function maskEmail(string $email): string {
    $parts = explode('@', $email, 2);
    if (count($parts) !== 2) return $email;
    $local = $parts[0];
    $domain = '@' . $parts[1];
    $visible = substr($local, 0, min(2, strlen($local)));
    $stars = str_repeat('*', max(1, strlen($local) - strlen($visible)));
    return htmlspecialchars($visible . $stars . $domain, ENT_QUOTES, 'UTF-8');
}

// ─── Admin endpoint ───────────────────────────────────────────────────────────
// Used by LeadFinder to sync unsubscribes. Call as: ?admin=YOUR_SECRET

if (isset($_GET['admin'])) {
    if ($_GET['admin'] !== ADMIN_SECRET) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
    header('Content-Type: application/json');
    $data = loadData();
    // Return only what LeadFinder needs
    $out = array_map(fn($r) => [
        'email'           => $r['email'] ?? '',
        'company_name'    => $r['company'] ?? null,
        'token'           => $r['token'] ?? '',
        'unsubscribed_at' => $r['unsubscribed_at'] ?? '',
    ], $data);
    echo json_encode($out);
    exit;
}

// ─── Read URL parameters ──────────────────────────────────────────────────────

$token   = isset($_GET['t']) ? preg_replace('/[^a-zA-Z0-9._-]/', '', (string)$_GET['t']) : '';
$email   = isset($_GET['e']) ? trim(urldecode((string)$_GET['e'])) : '';
$company = isset($_GET['n']) ? trim(urldecode((string)$_GET['n'])) : '';

if (!$token || !$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">'
       . '<h2>Invalid unsubscribe link</h2><p>This link may have expired or is malformed.</p>'
       . '</body></html>';
    exit;
}

// ─── POST: record the unsubscribe ─────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = loadData();
    if (!isUnsubscribed($data, $email)) {
        $data[] = [
            'email'           => strtolower(trim($email)),
            'token'           => $token,
            'company'         => $company ?: null,
            'unsubscribed_at' => date('c'), // ISO 8601
        ];
        saveData($data);
    }
    header('Content-Type: application/json');
    echo json_encode(['unsubscribed' => true, 'email' => strtolower(trim($email))]);
    exit;
}

// ─── GET: show the branded page ───────────────────────────────────────────────

$data               = loadData();
$alreadyUnsubscribed = isUnsubscribed($data, $email);
$maskedEmail        = maskEmail($email);
$safeCompany        = htmlspecialchars($company, ENT_QUOTES, 'UTF-8');

// Build the POST URL (same page, same query string)
$currentUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http')
    . '://' . htmlspecialchars($_SERVER['HTTP_HOST'], ENT_QUOTES, 'UTF-8')
    . htmlspecialchars($_SERVER['REQUEST_URI'], ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unsubscribe — Verbose Tech Labs</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f4f4f8;
      color: #1a1a2e;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);
      max-width: 480px;
      width: 100%;
      padding: 48px 40px 40px;
      text-align: center;
    }
    .logo-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 36px;
    }
    .logo-img { width: 40px; height: 40px; border-radius: 8px; object-fit: contain; }
    .logo-text { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; color: #111827; }
    .logo-sub  { font-size: 11px; font-weight: 500; color: #6b7280; letter-spacing: 0.6px; text-transform: uppercase; margin-top: 2px; }
    .icon-wrap {
      width: 72px; height: 72px; border-radius: 50%;
      background: #fef2f2;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 24px;
    }
    .icon-wrap svg { color: #ef4444; }
    .icon-ok { background: #f0fdf4 !important; }
    .icon-ok svg { color: #22c55e !important; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 12px; line-height: 1.35; }
    .sub { font-size: 15px; color: #6b7280; line-height: 1.65; margin-bottom: 8px; }
    .chip {
      display: inline-block;
      background: #f3f4f6; color: #374151;
      font-size: 13px; font-weight: 500; font-family: monospace;
      padding: 5px 16px; border-radius: 100px; margin-bottom: 28px; margin-top: 4px;
    }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; width: 100%; padding: 14px 24px; border-radius: 12px;
      font-size: 16px; font-weight: 600; cursor: pointer; border: none;
      transition: background 0.15s, opacity 0.15s;
    }
    .btn-red  { background: #ef4444; color: #fff; }
    .btn-red:hover:not(:disabled) { background: #dc2626; }
    .btn-red:disabled { opacity: 0.55; cursor: not-allowed; }
    .err { display: none; color: #ef4444; font-size: 13px; margin-top: 12px; }
    .note { margin-top: 28px; font-size: 12px; color: #9ca3af; }
    #ok { display: none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 0.75s linear infinite; }
  </style>
</head>
<body>
<div class="card">

  <!-- Logo -->
  <div class="logo-wrap">
    <img class="logo-img"
      src="https://verbosetech.com/favicon.ico"
      onerror="this.style.display='none'"
      alt="VTL" />
    <div>
      <div class="logo-text">Verbose Tech Labs</div>
      <div class="logo-sub">B2B Data Provider</div>
    </div>
  </div>

  <!-- Main state -->
  <div id="main">
    <?php if ($alreadyUnsubscribed): ?>
      <div class="icon-wrap icon-ok">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      </div>
      <h1>Already Unsubscribed</h1>
      <p class="sub">You're already off our mailing list.</p>
      <div class="chip"><?= $maskedEmail ?></div>
      <p class="sub" style="font-size:13px;margin-top:2px;">
        You won't receive any more outreach emails from us.
      </p>
    <?php else: ?>
      <div class="icon-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" viewBox="0 0 24 24">
          <rect width="20" height="16" x="2" y="4" rx="2"/>
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
        </svg>
      </div>
      <h1>Are you sure you don't want to receive our emails?</h1>
      <p class="sub">
        <?php if ($safeCompany): ?>
          We've been reaching out to <strong><?= $safeCompany ?></strong> about
          B2B data solutions from Verbose Tech Labs.
        <?php else: ?>
          We send carefully curated B2B data and intelligence emails.
        <?php endif; ?>
      </p>
      <div class="chip"><?= $maskedEmail ?></div>
      <button class="btn btn-red" id="btn" onclick="doUnsub()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-linejoin="round" viewBox="0 0 24 24">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" x2="9" y1="12" y2="12"/>
        </svg>
        Unsubscribe
      </button>
      <div class="err" id="err">Something went wrong. Please try again.</div>
    <?php endif; ?>
  </div>

  <!-- Success (shown by JS after POST) -->
  <div id="ok">
    <div class="icon-wrap icon-ok">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none"
        stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
        stroke-linejoin="round" viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h1>Successfully Unsubscribed</h1>
    <p class="sub">You've been removed from our mailing list.</p>
    <div class="chip"><?= $maskedEmail ?></div>
    <p class="sub" style="font-size:13px;margin-top:2px;">
      We respect your choice. You won't hear from us again.
    </p>
  </div>

  <p class="note">Verbose Tech Labs &mdash; B2B Data Intelligence</p>
</div>

<script>
async function doUnsub() {
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"
      stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
      viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    Processing…`;
  try {
    const res = await fetch(window.location.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: ''
    });
    if (!res.ok) throw new Error();
    const json = await res.json();
    if (json.unsubscribed) {
      document.getElementById('main').style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    } else {
      throw new Error();
    }
  } catch {
    btn.disabled = false;
    btn.innerHTML = 'Unsubscribe';
    err.style.display = 'block';
  }
}
</script>
<style>@keyframes spin { to { transform: rotate(360deg); } }</style>
</body>
</html>
