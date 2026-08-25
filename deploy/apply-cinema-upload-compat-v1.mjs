import fs from 'node:fs';

const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`C-Party upload compatibility patch failed: ${label}`);
  return source.replace(from, to);
};

const file = 'backend/admin-cinema-library.js';
let source = fs.readFileSync(file, 'utf8');
const marker = '// CPARTY_UPLOAD_COMPAT_V1';

if (!source.includes(marker)) {
  source = replaceRequired(
    source,
    "    const jobId = crypto.randomUUID();\n    const jobKey = crypto.randomBytes(24).toString('hex');\n    const jobFile = path.join(jobsRoot, `${jobId}.json`);\n    await fs.promises.writeFile(jobFile, JSON.stringify({\n      jobId,\n      key: jobKey,\n      status: 'queued',",
    "    const jobId = crypto.randomUUID();\n    const jobKey = crypto.randomBytes(24).toString('hex');\n    const targetName = `${crypto.randomUUID()}.mp4`;\n    const jobFile = path.join(jobsRoot, `${jobId}.json`);\n    await fs.promises.writeFile(jobFile, JSON.stringify({\n      jobId,\n      key: jobKey,\n      targetName,\n      status: 'queued',",
    'new upload target name',
  );

  source = replaceRequired(
    source,
    "      statusUrl: `/admin/desktop/cinema/transcode/${jobId}`,\n      fileName: session.original_name,",
    "      statusUrl: `/admin/desktop/cinema/transcode/${jobId}`,\n      mediaUrl: `/cinema/media/${targetName}`,\n      fileName: session.original_name,\n      // CPARTY_UPLOAD_COMPAT_V1: old desktop clients can save this final URL immediately",
    'new upload pending media URL',
  );

  source = replaceRequired(
    source,
    "    const jobId = crypto.randomUUID();\n    const jobKey = crypto.randomBytes(24).toString('hex');\n    const jobFile = path.join(jobsRoot, `${jobId}.json`);\n    await fs.promises.writeFile(jobFile, JSON.stringify({\n      jobId,\n      key: jobKey,\n      status: 'queued',",
    "    const jobId = crypto.randomUUID();\n    const jobKey = crypto.randomBytes(24).toString('hex');\n    const targetName = `${crypto.randomUUID()}.mp4`;\n    const jobFile = path.join(jobsRoot, `${jobId}.json`);\n    await fs.promises.writeFile(jobFile, JSON.stringify({\n      jobId,\n      key: jobKey,\n      targetName,\n      status: 'queued',",
    'existing upload target name',
  );

  source = replaceRequired(
    source,
    "    res.status(202).json({ processing: true, complete: false, jobId, jobKey, statusUrl: `/admin/desktop/cinema/transcode/${jobId}` });",
    "    res.status(202).json({ processing: true, complete: false, jobId, jobKey, statusUrl: `/admin/desktop/cinema/transcode/${jobId}`, mediaUrl: `/cinema/media/${targetName}` });",
    'existing media pending URL',
  );
}

fs.writeFileSync(file, source, 'utf8');
console.log('C-Party async media conversion remains compatible with older Admin Desktop clients via stable pending MP4 URLs.');
