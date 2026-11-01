<?php
// Synchro de /argent entre appareils. Le serveur ne reçoit qu'un bloc chiffré dans le navigateur :
// il ne peut pas le lire. Les fichiers vivent hors du site (../argent-sync), à l'abri du rsync --delete.
header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

function fail(int $code, string $why): void {
    http_response_code($code);
    echo json_encode(['error' => $why]);
    exit;
}

$dir = dirname(__DIR__) . '/argent-sync';
$id = $_GET['id'] ?? '';
if (!preg_match('/^[a-f0-9]{64}$/', $id)) fail(400, 'id');
if (!is_dir($dir) && !mkdir($dir, 0700)) fail(500, 'dir');
$file = "$dir/$id.json";

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!is_file($file)) fail(404, 'none');
    readfile($file);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'method');

$body = file_get_contents('php://input', false, null, 0, 5000001);
if (strlen($body) > 5000000) fail(413, 'size');
$in = json_decode($body, true);
if (!is_array($in) || !is_string($in['data'] ?? null) || !is_int($in['v'] ?? null) || !is_int($in['base'] ?? null)) {
    fail(400, 'body');
}
if (!is_file($file)) {
    // Rien ici alors que l'appareil croit à une version : on le dit (409, version 0) sans créer de fichier
    // vide ; le fichier n'est créé qu'au moment d'écrire.
    if ($in['base'] !== 0) {
        http_response_code(409);
        echo '{"v":0}';
        exit;
    }
    // Pas plus de quelques espaces de synchro : personne ne peut remplir le disque.
    if (count(glob("$dir/*.json")) >= 10) fail(507, 'full');
}

$fp = fopen($file, 'c+');
if (!$fp || !flock($fp, LOCK_EX)) fail(500, 'lock');
$cur = stream_get_contents($fp);
$curV = $cur ? (json_decode($cur, true)['v'] ?? 0) : 0;
// Un autre appareil a écrit entre-temps : on renvoie sa version au lieu de l'écraser.
if ($in['base'] !== $curV) {
    flock($fp, LOCK_UN);
    http_response_code(409);
    echo $cur ?: '{"v":0}';
    exit;
}
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode(['v' => $in['v'], 'data' => $in['data']]));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);
echo json_encode(['v' => $in['v']]);
