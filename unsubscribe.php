<?php
/**
 * LeadFinder Unsubscribe Handler
 * Upload this file to your hosting at the path set in Settings → Email Tracking → Unsubscribe Page URL
 *
 * How it works:
 *   1. When a recipient clicks the unsubscribe link in an email, they hit this page (GET ?t=TOKEN&e=EMAIL&n=COMPANY)
 *   2. This page records the unsubscribe in a local log file (unsubscribes.json) and shows a confirmation page
 *   3. When you click "Sync Unsubscribers" in the app, it calls this page with ?admin=YOUR_SECRET
 *      and gets back the full list as JSON so the app can import them.
 *
 * Setup:
 *   1. Upload this file to your hosting (e.g. https://verbosetechlabs.com/unsubscribe.php)
 *   2. In Settings → Email Tracking, set:
 *        Unsubscribe Page URL  →  https://verbosetechlabs.com/unsubscribe.php
 *        Unsubscribe Admin Secret  →  (any long random string, e.g. "my-secret-key-123")
 *   3. The unsubscribes.json file will be created automatically in the same directory.
 *      Make sure the directory is writable by the web server.
 */

// ── Config ─────────────────────────────────────────────────────────────────────
define('LOG_FILE', __DIR__ . '/unsubscribes.json');

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadLog(): array {
    if (!file_exists(LOG_FILE)) return [];
    $data = @json_decode(file_get_contents(LOG_FILE), true);
    return is_array($data) ? $data : [];
}

function saveLog(array $entries): void {
    file_put_contents(LOG_FILE, json_encode(array_values($entries), JSON_PRETTY_PRINT));
}

function recordUnsubscribe(string $email, string $token, string $company): void {
    $entries = loadLog();
    foreach ($entries as $e) {
        if (strtolower($e['email']) === strtolower($email)) return; // already recorded
    }
    $entries[] = [
        'email'          => strtolower(trim($email)),
        'company_name'   => $company ?: null,
        'token'          => $token,
        'unsubscribed_at'=> date('c'),
    ];
    saveLog($entries);
}

// ── Admin list endpoint (?admin=SECRET) ────────────────────────────────────────

if (isset($_GET['admin'])) {
    // The app calls this to fetch all recorded unsubscribes
    // The secret is compared to the value set in your app settings
    // (Settings → Email Tracking → Unsubscribe Admin Secret)
    $providedSecret = trim($_GET['admin']);
    if (empty($providedSecret)) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Secret required']);
        exit;
    }
    // Return the full log as JSON
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    echo json_encode(loadLog());
    exit;
}

// ── Unsubscribe click handler ──────────────────────────────────────────────────

$token   = trim($_GET['t']   ?? '');
$email   = trim($_GET['e']   ?? '');
$company = trim($_GET['n']   ?? '');

// Handle POST confirmation (one-click unsubscribe)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($email) recordUnsubscribe($email, $token, $company);
    header('Content-Type: application/json');
    echo json_encode(['unsubscribed' => true, 'email' => $email]);
    exit;
}

// Record on GET as well (simple click)
if ($email && $token) {
    recordUnsubscribe($email, $token, $company);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unsubscribe</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #f9fafb; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; padding: 24px; }
  .card { background: #fff; border-radius: 16px; padding: 40px;
          max-width: 420px; width: 100%; text-align: center;
          box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  h1 { font-size: 1.5rem; font-weight: 700; color: #111; margin-bottom: 8px; }
  p  { color: #6b7280; line-height: 1.6; margin-bottom: 20px; }
  .email { font-family: monospace; background: #f3f4f6; border-radius: 8px;
           padding: 6px 12px; font-size: 0.9rem; color: #111; display: inline-block;
           margin-bottom: 20px; }
  .success { color: #059669; font-weight: 600; }
</style>
</head>
<body>
<div class="card">
<?php if ($email): ?>
  <h1>You've been unsubscribed</h1>
  <div class="email"><?= htmlspecialchars($email) ?></div>
  <p class="success">✓ You will no longer receive emails from us.</p>
  <p style="font-size:.85rem">If this was a mistake, please contact us directly.</p>
<?php else: ?>
  <h1>Unsubscribe</h1>
  <p>This link appears to be invalid or has expired. Please contact us directly if you'd like to unsubscribe.</p>
<?php endif; ?>
</div>
</body>
</html>
