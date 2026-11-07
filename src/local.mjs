import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { StarpostWorld, STARPOST_DEFAULTS, relayVersion } from '../lib/core.mjs';

export function clientHome() {
  return resolve(process.env.STARPOST_DSH_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'starpost'));
}
export function loadSettings(dir) {
  const file = join(dir, 'client.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}
export function options(settings, dir) {
  const cfg = structuredClone(STARPOST_DEFAULTS);
  cfg.enabled = true;
  const url = new URL(settings.serverUrl ?? cfg.serverUrl);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('请使用 HTTPS 服务地址，本机测试可用 HTTP 回环地址');
  cfg.serverUrl = url.origin;
  const pin = join(dir, 'server-origin');
  if (existsSync(pin) && readFileSync(pin, 'utf8') !== url.origin) throw Error('账号数据已绑定其他服务器，请为新服务器选择独立的数据目录');
  cfg.receiveMode = settings.receiveMode ?? cfg.receiveMode;
  if (!['active','mixed','passive'].includes(cfg.receiveMode)) throw Error('接收模式须为 active、mixed 或 passive');
  cfg.emojiDir = resolve(dir, settings.emojiDir || 'emoji');
  for (const [key, min, max] of [['maxMessagesPerDay',0,1000000],['maxWerewolfGamesPerDay',0,1000],['maxGroups',0,1000],['maxPrivateChats',0,1000],['deliveryIntervalMs',1000,300000]]) {
    if (Object.hasOwn(settings,key)) {
      if (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max) throw Error(key+' 超出允许范围');
      cfg[key] = settings[key];
    }
  }
  return cfg;
}
export function validateSettings(dir, settings) {
  options(settings, dir);
  if (typeof settings.sessionId !== 'string' || !settings.sessionId.trim() || settings.sessionId.length > 512 || /[\x00-\x1f\x7f]/.test(settings.sessionId)) throw Error('请指定有效的 DSH 会话 ID');
}
export function saveSettings(dir, settings) {
  validateSettings(dir,settings);
  const tmp = join(dir, randomUUID()+'.tmp');
  writeFileSync(tmp, JSON.stringify(settings,null,2)+'\n', {mode:0o600});
  renameSync(tmp,join(dir,'client.json'));
}
// SQLite releases this process lock even if the desktop crashes.
export function lock(dir) {
  mkdirSync(dir,{recursive:true,mode:0o700});
  const db = new DatabaseSync(join(dir,'client-lock.sqlite'));
  try { db.exec('BEGIN IMMEDIATE'); } catch { db.close(); throw Error('此星邮数据目录正在使用，请先关闭使用它的 Harness 实例'); }
  return () => db.close();
}
export function makeWorld(dir, settings) {
  const cfg = options(settings, dir);
  return new StarpostWorld(cfg, dir, dir, dir, 'Asia/Shanghai', () => '', Date.now, () => relayVersion);
}
export function pinServer(dir, settings) {
  const origin = options(settings,dir).serverUrl;
  const path = join(dir,'server-origin');
  if (!existsSync(path)) writeFileSync(path,origin,{flag:'wx',mode:0o600});
}
