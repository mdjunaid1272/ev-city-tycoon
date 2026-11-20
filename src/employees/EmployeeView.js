import * as THREE from 'three';
import { animateCharacter } from '../world/Models.js';
import { makeLabel } from '../businesses/StationView.js';

const STATE_TEXT = {
  idle: 'Waiting for work', move: 'Heading to task', perform: 'Working', complete: 'Done', recover: 'Re-planning route',
  arriving: 'Starting shift', return: 'Back to post', offduty: 'Off duty', leaving: 'Leaving',
};
const SKIN = [0xf2c9a0, 0xd9a273, 0x8d5a3b, 0xf7d9bd];
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const $ = (n) => `$${n.toLocaleString('en-US')}`;

/** Visual layer for employees: models, animation, labels and management-mode selection cards. */
export class EmployeeView {
  constructor({ scene, assets, manager, economy, bus }) {
    this.scene = scene;
    this.assets = assets;
    this.mgr = manager;
    this.economy = economy;
    this.bus = bus;
    this.views = new Map(); // employee id -> {model, label, phase}
    this.selectables = [];
    this.mgmt = false;
    this.mgFactor = 1;
    this.t = 0;
  }

  create(e) {
    const def = this.mgr.cfg.roles[e.role];
    const idx = Number(e.id.replace(/\D/g, '')) || 0;
    const model = this.assets.create('character', { shirt: Number(def.shirt), hat: Number(def.hat), pants: 0x2b3a55, skin: SKIN[idx % SKIN.length] });
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;
    model.add(blob);
    const label = makeLabel(2.6);
    label.sprite.position.y = 2.9;
    model.add(label.sprite);
    model.userData.select = () => this.info(e);
    model.userData.focus = model.position;
    this.scene.add(model);
    this.selectables.push(model);
    const v = { model, label, phase: Math.random() * 6, lastKey: '' };
    this.views.set(e.id, v);
    return v;
  }

  remove(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.model);
    this.selectables.splice(this.selectables.indexOf(v.model), 1);
    this.views.delete(id);
  }

  info(e) {
    const m = this.mgr, def = m.cfg.roles[e.role];
    if (!m.employees.includes(e) || e.leaving) return null; // fired / quit: the panel closes itself
    const rows = [
      ['Skill', stars(e.skill)], ['Work speed', `x${m.workMult(e).toFixed(2)}`], ['Experience', `Lv ${m.level(e)} · ${e.xp} xp`],
      ['Salary', `${$(e.salary)}/day`], ['Status', e.dept === 'off' ? 'Off duty' : STATE_TEXT[e.state] || e.state], ['Tasks done', e.tasksDone],
    ];
    if (e.role === 'manager') rows.push(['Team bonus', `+${Math.round(m.teamBonus * 100)}% speed · auto-priority`]);
    if (e.role === 'cashier') rows.push(['Satisfaction bonus', `+${m.satisfactionBonus.toFixed(1)}`]);
    const tc = m.trainCost(e);
    return {
      title: `${def.icon} ${e.name}`, subtitle: def.label, rows,
      // only real actions: skill training, workplace change (when the role can work elsewhere), duty, staff board, fire (confirmed)
      actions: [
        ...(e.skill < m.cfg.maxSkill ? [{ label: `Upgrade skill → ${e.skill + 1} · ${$(tc)}`, disabled: !this.economy.canAfford(tc), reason: `Not enough cash: ${$(Math.max(0, Math.ceil(tc - this.economy.cash)))} more needed`, cb: () => m.train(e.id) }] : []),
        ...(m.eligibleDepts(e).length > 1 ? [{ label: `Change workplace · ${m.facilities[m.homeOf(e)]?.label || m.homeOf(e)} ▸`, kind: 'secondary', cb: () => m.transfer(e.id) }] : []),
        { label: e.dept === 'off' ? 'Put on duty' : 'Send off duty', kind: 'secondary', cb: () => m.assign(e.id, e.dept === 'off' ? m.homeOf(e) : 'off') },
        { label: 'Open Staff board', kind: 'secondary', cb: () => this.bus.emit('ui:open', 'staff') },
        { label: 'Fire', kind: 'danger', cb: () => this.bus.emit('ui:fire', e.id) },
      ],
    };
  }

  setManagementMode(on) {
    this.mgmt = on;
  }

  update(dt) {
    this.t += dt;
    const live = new Set();
    for (const e of this.mgr.employees) {
      live.add(e.id);
      const v = this.views.get(e.id) || this.create(e);
      const m = v.model;
      m.position.set(e.pos.x, 0.34, e.pos.z);
      m.rotation.y = e.yaw;
      const performing = e.state === 'perform';
      if (e.moving) { v.phase += dt * (3 + this.mgr.cfg.walkSpeed * 1.6); animateCharacter(m, v.phase, 1, this.t); }
      else {
        animateCharacter(m, 0, 0, this.t);
        if (performing) { // plugging in / unplugging: arms reach out toward the charger
          const k = Math.sin(this.t * 7) * 0.25;
          m.userData.armR.rotation.x = -1.35 + k;
          m.userData.armL.rotation.x = -1.1 - k;
        }
      }
      const show = this.mgmt || performing;
      v.label.sprite.visible = show;
      const s = this.mgmt ? Math.min(3.2, Math.max(1, this.mgFactor * 1.1)) * 2.6 : 2.6;
      v.label.sprite.scale.set(s, s * (96 / 256), 1);
      if (show) {
        const def = this.mgr.cfg.roles[e.role];
        const pct = performing ? Math.min(1, e.timer / Math.max(0.01, e.duration)) : null;
        const text = e.dept === 'off' ? 'Off duty' : performing && e.task ? (e.task.type === 'connect' ? 'Connecting…' : 'Unplugging…') : STATE_TEXT[e.state] || e.state;
        const key = `${e.name}|${text}|${pct === null ? '' : Math.round(pct * 20)}`;
        if (key !== v.lastKey) {
          v.lastKey = key;
          v.label.draw({ title: `${def.icon} ${e.name}`, sub: text, pct, color: '#1b6ef3' });
        }
      }
    }
    for (const id of [...this.views.keys()]) if (!live.has(id)) this.remove(id);
  }
}
