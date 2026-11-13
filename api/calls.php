<?php

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

function respondJson($status, $body)
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function isValidDate($value)
{
    if (!preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/', $value, $parts)) {
        return false;
    }

    return checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    respondJson(405, ['error' => 'Only GET is supported.']);
}

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    respondJson(503, ['error' => 'Call reports are not configured on the server.']);
}

$config = require $configPath;
if (!is_array($config)
    || empty($config['n8n_api_key'])
    || empty($config['staff_password'])
    || strpos($config['n8n_api_key'], 'REPLACE_') === 0
    || strpos($config['staff_password'], 'REPLACE_') === 0
    || !preg_match('/^[a-f0-9]{64}$/i', $config['n8n_api_key'])) {
    respondJson(503, ['error' => 'Call reports server credentials are incomplete.']);
}

$authorization = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if ($authorization === '' && function_exists('getallheaders')) {
    $headers = getallheaders();
    foreach ($headers as $name => $value) {
        if (strtolower($name) === 'authorization') {
            $authorization = $value;
            break;
        }
    }
}

$staffPassword = '';
if (preg_match('/^Basic\s+(.+)$/i', $authorization, $matches)) {
    $decoded = base64_decode($matches[1], true);
    if ($decoded !== false && strpos($decoded, 'reports:') === 0) {
        $staffPassword = substr($decoded, strlen('reports:'));
    }
}

if ($staffPassword === '' || !hash_equals((string) $config['staff_password'], $staffPassword)) {
    header('WWW-Authenticate: Basic realm="Jain Farms Call Reports", charset="UTF-8"');
    respondJson(401, ['error' => 'Staff sign-in required.']);
}

$from = isset($_GET['from']) ? trim((string) $_GET['from']) : '';
$to = isset($_GET['to']) ? trim((string) $_GET['to']) : '';
$status = isset($_GET['status']) ? strtoupper(trim((string) $_GET['status'])) : 'ALL';
$search = isset($_GET['search']) ? trim((string) $_GET['search']) : '';

if (($from !== '' && !isValidDate($from))
    || ($to !== '' && !isValidDate($to))
    || ($from !== '' && $to !== '' && $from > $to)
    || !in_array($status, ['ALL', 'ANSWERED', 'MISSED'], true)
    || strlen($search) > 480) {
    respondJson(400, ['error' => 'Invalid filters. Check dates, status, and search length.']);
}

$query = http_build_query([
    'from' => $from,
    'to' => $to,
    'status' => $status,
    'search' => $search,
]);
$upstreamUrl = 'https://n8n.srv1864214.hstgr.cloud/webhook/jfr-call-reports?' . $query;
$context = stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => "Accept: application/json\r\nX-JFR-Report-Key: " . $config['n8n_api_key'] . "\r\n",
        'timeout' => 20,
        'ignore_errors' => true,
    ],
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
    ],
]);

$upstreamBody = @file_get_contents($upstreamUrl, false, $context);
if ($upstreamBody === false) {
    respondJson(502, ['error' => 'Could not reach the call report service.']);
}

$upstreamStatus = 502;
foreach (isset($http_response_header) ? $http_response_header : [] as $headerLine) {
    if (preg_match('/^HTTP\/\S+\s+([0-9]{3})/', $headerLine, $statusMatch)) {
        $upstreamStatus = (int) $statusMatch[1];
    }
}

if ($upstreamStatus === 401 || $upstreamStatus === 403) {
    respondJson(502, ['error' => 'Call report service authentication failed.']);
}

$body = json_decode($upstreamBody, true);
if (!is_array($body)) {
    respondJson(502, ['error' => 'Call report service returned an invalid response.']);
}

if ($upstreamStatus < 200 || $upstreamStatus >= 500) {
    respondJson(502, ['error' => isset($body['error']) ? $body['error'] : 'Call report service failed.']);
}

respondJson($upstreamStatus, $body);
