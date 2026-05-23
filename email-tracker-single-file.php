<?php
/**
 * Single-file email tracker.
 *
 * Upload this file to your server, for example:
 *   https://yourdomain.com/email-tracker.php
 *
 * It supports:
 *   1. Open tracking pixel:
 *      https://yourdomain.com/email-tracker.php?t=open&id=UNIQUE_EMAIL_ID
 *
 *   2. Click tracking + redirect:
 *      https://yourdomain.com/email-tracker.php?t=click&id=UNIQUE_EMAIL_ID&url=https%3A%2F%2Fexample.com
 *
 *   3. Simple private stats page:
 *      https://yourdomain.com/email-tracker.php?admin=CHANGE_THIS_SECRET
 *
 * Change the two values below before uploading.
 */

$ADMIN_SECRET = 'CHANGE_THIS_SECRET';
$PRIMARY_LOG_FILE = __DIR__ . '/email-tracker-events.csv';
$FALLBACK_LOG_FILE = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'leadfinder-email-tracker-events.csv';

function tracker_log_file() {
    global $PRIMARY_LOG_FILE, $FALLBACK_LOG_FILE;

    if (file_exists($PRIMARY_LOG_FILE) && is_writable($PRIMARY_LOG_FILE)) {
        return $PRIMARY_LOG_FILE;
    }

    if (!file_exists($PRIMARY_LOG_FILE) && is_writable(__DIR__)) {
        return $PRIMARY_LOG_FILE;
    }

    return $FALLBACK_LOG_FILE;
}

function tracker_now() {
    return gmdate('Y-m-d H:i:s');
}

function tracker_client_ip() {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
        if (!empty($_SERVER[$key])) {
            return trim(explode(',', $_SERVER[$key])[0]);
        }
    }
    return '';
}

function tracker_log_event($type, $id, $url = '') {
    $log_file = tracker_log_file();

    $is_new_file = !file_exists($log_file);
    $handle = fopen($log_file, 'a');
    if (!$handle) {
        return false;
    }

    if ($is_new_file) {
        fputcsv($handle, [
            'time_utc',
            'type',
            'tracking_id',
            'url',
            'ip',
            'user_agent',
        ]);
    }

    fputcsv($handle, [
        tracker_now(),
        $type,
        $id,
        $url,
        tracker_client_ip(),
        $_SERVER['HTTP_USER_AGENT'] ?? '',
    ]);

    fclose($handle);
    return true;
}

function tracker_events() {
    $log_file = tracker_log_file();
    if (!file_exists($log_file)) {
        return [];
    }

    $handle = fopen($log_file, 'r');
    if (!$handle) {
        return [];
    }

    $headers = fgetcsv($handle);
    $rows = [];
    while (($data = fgetcsv($handle)) !== false) {
        if (!$headers || count($headers) !== count($data)) {
            continue;
        }
        $rows[] = array_combine($headers, $data);
    }
    fclose($handle);
    return $rows;
}

function tracker_pixel_response() {
    $pixel = base64_decode(
        'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
    );
    header('Content-Type: image/gif');
    header('Content-Length: ' . strlen($pixel));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo $pixel;
    exit;
}

function tracker_safe_redirect($url) {
    $parts = parse_url($url);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        http_response_code(400);
        echo 'Invalid redirect URL.';
        exit;
    }

    if (!in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        http_response_code(400);
        echo 'Only http and https links are allowed.';
        exit;
    }

    header('Location: ' . $url, true, 302);
    exit;
}

function tracker_admin_page() {
    $events = tracker_events();
    $summary = [];

    foreach ($events as $event) {
        $id = $event['tracking_id'] ?: '(missing)';
        if (!isset($summary[$id])) {
            $summary[$id] = [
                'tracking_id' => $id,
                'opens' => 0,
                'clicks' => 0,
                'first_open' => '',
                'last_open' => '',
                'last_click' => '',
            ];
        }

        if ($event['type'] === 'open') {
            $summary[$id]['opens']++;
            if (!$summary[$id]['first_open']) {
                $summary[$id]['first_open'] = $event['time_utc'];
            }
            $summary[$id]['last_open'] = $event['time_utc'];
        }

        if ($event['type'] === 'click') {
            $summary[$id]['clicks']++;
            $summary[$id]['last_click'] = $event['time_utc'];
        }
    }

    usort($summary, function ($a, $b) {
        return strcmp($b['last_open'] . $b['last_click'], $a['last_open'] . $a['last_click']);
    });

    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>Email Tracker</title>';
    echo '<style>
        body{font-family:Arial,sans-serif;background:#f6f7fb;color:#111827;margin:0;padding:28px}
        h1{margin:0 0 8px}.muted{color:#6b7280;margin-bottom:22px}
        table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden}
        th,td{text-align:left;padding:12px;border-bottom:1px solid #e5e7eb;font-size:14px}
        th{background:#111827;color:white}
        .card{background:white;padding:18px;border-radius:12px;margin-bottom:18px}
        code{background:#eef2ff;padding:2px 6px;border-radius:6px}
    </style></head><body>';
    echo '<h1>Email Tracker</h1>';
    echo '<div class="muted">Times are shown in UTC. Open tracking can be blocked by some email apps.</div>';
    echo '<div class="card">Total events: <strong>' . count($events) . '</strong></div>';
    echo '<div class="card">Log file: <code>' . htmlspecialchars(tracker_log_file()) . '</code></div>';
    echo '<table><thead><tr><th>Tracking ID</th><th>Opens</th><th>Clicks</th><th>First Open</th><th>Last Open</th><th>Last Click</th></tr></thead><tbody>';
    foreach ($summary as $row) {
        echo '<tr>';
        echo '<td><code>' . htmlspecialchars($row['tracking_id']) . '</code></td>';
        echo '<td>' . (int)$row['opens'] . '</td>';
        echo '<td>' . (int)$row['clicks'] . '</td>';
        echo '<td>' . htmlspecialchars($row['first_open']) . '</td>';
        echo '<td>' . htmlspecialchars($row['last_open']) . '</td>';
        echo '<td>' . htmlspecialchars($row['last_click']) . '</td>';
        echo '</tr>';
    }
    echo '</tbody></table></body></html>';
    exit;
}

if (isset($_GET['admin'])) {
    if (!hash_equals($ADMIN_SECRET, (string)$_GET['admin'])) {
        http_response_code(403);
        echo 'Forbidden';
        exit;
    }
    tracker_admin_page();
}

$type = $_GET['t'] ?? '';
$id = preg_replace('/[^a-zA-Z0-9._-]/', '', $_GET['id'] ?? '');

if (!$id) {
    http_response_code(400);
    echo 'Missing tracking ID.';
    exit;
}

if ($type === 'open') {
    tracker_log_event('open', $id);
    tracker_pixel_response();
}

if ($type === 'click') {
    $url = $_GET['url'] ?? '';
    tracker_log_event('click', $id, $url);
    tracker_safe_redirect($url);
}

http_response_code(400);
echo 'Invalid tracking type.';
