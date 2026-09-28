const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The original ID acquired a stale, blank Explorer taskbar icon. A stable new ID
// lets Explorer build a fresh group while existing Daily AI links are migrated.
const APP_ID = 'com.dailyai.desktop.v2';
const LEGACY_APP_ID = 'com.dailyai.desktop';

function cacheShellIcon(source, userData) {
  const bytes = fs.readFileSync(source);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12);
  const directory = path.join(userData, 'shell');
  fs.mkdirSync(directory, { recursive:true });
  // Explorer must not depend on the lifetime of a versioned ZIP extraction folder.
  const destination = path.join(directory, `daily-ai-${hash}.ico`);
  if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bytes)) {
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  }
  return destination;
}

function repairExistingShortcuts({ shell, files, executable, iconPath }) {
  const repaired = [];
  for (const file of new Set(files)) {
    if (!fs.existsSync(file)) continue;
    try {
      const previous = shell.readShortcutLink(file);
      const knownTarget = path.basename(previous.target || '').toLowerCase() === 'daily ai.exe';
      if (![APP_ID, LEGACY_APP_ID].includes(previous.appUserModelId) && !knownTarget) continue;
      const details = {
        target:executable, cwd:path.dirname(executable),
        icon:iconPath, iconIndex:0, appUserModelId:APP_ID
      };
      if (Object.entries(details).every(([key,value]) => previous[key] === value)) continue;
      // Update only our existing links; preserve shortcut arguments and user pinning.
      if (!shell.writeShortcutLink(file, 'update', details)) throw new Error('writeShortcutLink returned false');
      repaired.push(file);
    } catch (error) { console.warn(`[windows-shell] ${path.basename(file)}: ${error.message}`); }
  }
  return repaired;
}

function shortcutFiles(app) {
  const directories = [
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    app.getPath('desktop')
  ];
  return directories.flatMap(directory => {
    try { return fs.readdirSync(directory).filter(name => name.toLowerCase().endsWith('.lnk')).map(name => path.join(directory,name)); }
    catch { return []; }
  });
}

function prepareWindowsShell({ app, shell, iconSource, executable = process.execPath }) {
  let iconPath = iconSource;
  try { iconPath = cacheShellIcon(iconSource, app.getPath('userData')); }
  catch (error) { console.warn(`[windows-shell] icon cache: ${error.message}`); }
  const repaired = app.isPackaged
    ? repairExistingShortcuts({ shell, files:shortcutFiles(app), executable, iconPath })
    : [];
  const launch = app.isPackaged ? `"${executable}"` : `"${executable}" "${app.getAppPath()}"`;
  return {
    repaired,
    details:{ appId:APP_ID, appIconPath:iconPath, appIconIndex:0, relaunchCommand:launch, relaunchDisplayName:'Daily AI' }
  };
}

module.exports = { APP_ID, LEGACY_APP_ID, cacheShellIcon, repairExistingShortcuts, prepareWindowsShell };
