import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import { Settings, isMobile } from './Settings.js';
import { SceneManager } from './SceneManager.js';
import { AssetManager } from './AssetManager.js';
import { Input } from './Input.js';
import { SaveManager } from './SaveManager.js';
import { registerProceduralModels } from '../world/Models.js';
import { Colliders } from '../world/Colliders.js';
import { CityManager } from '../world/CityManager.js';
import { DayNight } from '../world/DayNight.js';
import { TrafficManager } from '../world/TrafficManager.js';
import { RoadManager } from '../world/RoadManager.js';
import { TrafficLightView } from '../world/TrafficLightView.js';
import { PedestrianManager } from '../world/PedestrianManager.js';
import { ParkingSystem } from '../vehicles/ParkingSystem.js';
import { PlayerController } from '../player/PlayerController.js';
import { InteractionSystem } from '../player/InteractionSystem.js';
import { CameraManager } from '../camera/CameraManager.js';
import { EconomyManager } from '../economy/EconomyManager.js';
import { ChargingStation } from '../businesses/ChargingStation.js';
import { StationView } from '../businesses/StationView.js';
import { CustomerManager } from '../customers/CustomerManager.js';
import { TaskManager } from '../employees/TaskManager.js';
import { NavGrid } from '../employees/NavGrid.js';
import { EmployeeManager } from '../employees/EmployeeManager.js';
import { ChargingTasks } from '../employees/ChargingTasks.js';
import { EmployeeView } from '../employees/EmployeeView.js';
import { CarWash } from '../businesses/CarWash.js';
import { PowerSystem } from '../businesses/PowerSystem.js';
import { ServiceHub } from '../businesses/ServiceHub.js';
import { ContractManager } from '../economy/ContractManager.js';
import { UpgradeManager } from '../economy/UpgradeManager.js';
import { OfflineManager, DailyReward } from '../economy/RetentionManager.js';
import { AdService } from './AdService.js';
import { StatsTracker } from '../progression/StatsTracker.js';
import { ProgressionManager } from '../progression/ProgressionManager.js';
import { GoalManager } from '../progression/GoalManager.js';
import { ChargingHub } from '../businesses/ChargingHub.js';
import { HubView } from '../businesses/HubView.js';
import { PropertyManager } from '../businesses/PropertyManager.js';
import { PlacementManager, SERVICE_FORBIDDEN, STATION_FORBIDDEN } from '../businesses/PlacementManager.js';
import { DistrictManager } from '../world/DistrictManager.js';
import { DecorSystem } from '../world/DecorSystem.js';
import { Garage } from '../businesses/Garage.js';
import { WashView } from '../businesses/WashView.js';
import { GarageView } from '../businesses/GarageView.js';
import { MissionManager } from '../progression/MissionManager.js';
import { UIManager, money } from '../ui/UIManager.js';
import { TutorialManager } from '../ui/TutorialManager.js';
import { Environment } from '../world/Environment.js';
import { playerYield } from '../vehicles/PlayerYield.js';

const $ = (id) => document.getElementById(id);

async function loadJson(url, fallback) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn(`[Game] could not load ${url}`, e);
    return fallback;
  }
}

/** Composition root: creates managers, wires them through the EventBus, runs the loop. */
export class Game {
  async start() {
    this.bus = new EventBus();
    this.settings = new Settings();
    this.touch = isMobile();
    this.paused = false;
    this.saver = new SaveManager();
    const step = (p, t) => { $('load-fill').style.width = `${p * 100}%`; $('load-text').textContent = t; };
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));

    step(0.05, 'Loading game data…');
    const [econCfg, vehicles, custCfg, empCfg, svcCfg, progCfg, missCfg, decorCfg] = await Promise.all([
      loadJson('./data/economy.json', null),
      loadJson('./data/vehicles.json', null),
      loadJson('./data/customers.json', null),
      loadJson('./data/employees.json', null),
      loadJson('./data/services.json', null),
      loadJson('./data/progression.json', null),
      loadJson('./data/missions.json', null),
      loadJson('./data/decor.json', null),
    ]);
    if (!econCfg || !vehicles || !custCfg || !empCfg || !svcCfg || !progCfg || !missCfg || !decorCfg) throw new Error('Game data failed to load (public/data/*.json)');
    const saved = await this.saver.load();

    step(0.15, 'Preparing renderer…');
    const canvas = $('c');
    this.sm = new SceneManager(canvas, this.settings);
    this.sm.env = new Environment({ scene: this.sm.scene, settings: this.settings });
    this.assets = new AssetManager();
    registerProceduralModels(this.assets);
    await this.assets.loadManifest('./data/assets.json');
    this.input = new Input(this.bus, canvas);
    this.colliders = new Colliders();
    await tick();

    step(0.3, 'Building the city…');
    this.city = new CityManager({ scene: this.sm.scene, colliders: this.colliders, settings: this.settings });
    this.city.build();
    this.sm.env.addLampGlow(this.city.lampPos);
    await tick();

    step(0.65, 'Setting up your charging station…');
    this.economy = new EconomyManager(this.bus, saved?.economy || { cash: econCfg.startingCash, gems: econCfg.startingGems });
    this.road = new RoadManager();
    this.parking = new ParkingSystem();
    this.lights = new TrafficLightView(this.sm.scene, this.road);
    this.traffic = new TrafficManager({ scene: this.sm.scene, assets: this.assets, settings: this.settings, road: this.road, colliders: this.colliders });
    this.peds = new PedestrianManager({ scene: this.sm.scene, assets: this.assets, settings: this.settings });
    this.stats = new StatsTracker(this.bus, saved?.stats);
    this.progression = new ProgressionManager({
      bus: this.bus, economy: this.economy, cfg: progCfg, stats: this.stats, saved: saved?.progression,
      getters: {
        baysBuilt: () => this.station?.unlockedCount || 0,
        employees: () => this.employees?.employees.filter((e) => !e.leaving).length || 0,
        built: (k) => (k === 'wash' ? !!this.wash?.built : k === 'garage' ? !!this.garage?.built : false),
        properties: () => this.properties?.ownedCount || 0,
      },
    });
    this.power = new PowerSystem({
      cfg: econCfg.power, tariff: econCfg.tariff, simScale: econCfg.simTimeScale, saved: saved?.station?.power,
      getSun: () => this.day?.sun ?? 0.6, getHour: () => this.day?.hour ?? 12,
    });
    this.station = new ChargingStation(this.bus, this.economy, econCfg, saved?.station, this.parking, { power: this.power, getStage: () => this.progression.stage });
    this.customers = new CustomerManager({
      bus: this.bus, economy: this.economy, station: this.station, parking: this.parking, config: custCfg,
      vehicleDefs: vehicles.vehicles, getHour: () => this.day?.hour ?? 12, saved: saved?.customers,
    });
    this.hub = new ServiceHub({ bus: this.bus, economy: this.economy, cfg: svcCfg.hub, getStage: () => this.progression.stage, getEmployees: () => this.employees, saved: saved?.hub });
    this.stationView = new StationView({
      scene: this.sm.scene, assets: this.assets, colliders: this.colliders, bus: this.bus, station: this.station, economy: this.economy,
      traffic: this.traffic, road: this.road, parking: this.parking, customers: this.customers, hub: this.hub,
    });
    this.player = new PlayerController({ scene: this.sm.scene, assets: this.assets, colliders: this.colliders, input: this.input });
    if (saved?.player) {
      this.player.pos.set(saved.player.x, 0.34, saved.player.z);
      this.player.yaw = saved.player.yaw || 0;
    }
    // employees: central task board, walkable grid for the lot, roster/AI, department task bridge, visuals
    this.nav = new NavGrid();
    this.nav.rebuild(this.colliders);
    this.tasks = new TaskManager(this.bus);
    this.employees = new EmployeeManager({
      bus: this.bus, economy: this.economy, tasks: this.tasks, config: empCfg,
      getReputation: () => this.economy.reputation, saved: saved?.employees,
      getCapacity: () => this.station.unlockedCount + (this.wash?.built ? this.wash.unlockedBays : 0) + (this.garage?.built ? this.garage.unlockedBays : 0) + Object.values(this.hubs || {}).reduce((n, h) => n + (h.built ? h.unlockedBays : 0), 0),
    });
    this.employees.colliders = this.colliders; // staff are solid
    this.employees.player = this.player.pos;
    this.employees.registerFacility('charging', {
      nav: this.nav, label: 'Charging Station', built: () => true,
      posts: [{ x: -0.8, z: 3.6 }, { x: 0.8, z: 3.6 }, { x: -0.8, z: 2.0 }, { x: 0.8, z: 2.0 }, { x: 0, z: -2.6 }],
      door: { x: -14, z: -11.4 }, breakSpot: { x: -16.5, z: -10.5 },
    });
    // car wash + garage (built later by the player on the neighbouring lots)
    const svcArgs = { bus: this.bus, economy: this.economy, parking: this.parking, cfg: svcCfg, custCfg, tasks: this.tasks, getEmployees: () => this.employees, vehicleDefs: vehicles.vehicles, getHour: () => this.day?.hour ?? 12 };
    this.wash = new CarWash({ ...svcArgs, saved: saved?.wash });
    this.garage = new Garage({ ...svcArgs, saved: saved?.garage });
    const lotArgs = (biz, origin, edge) => ({
      scene: this.sm.scene, assets: this.assets, colliders: this.colliders, bus: this.bus, business: biz, traffic: this.traffic, road: this.road,
      parking: this.parking, employees: this.employees, origin, edge, economy: this.economy, onBuilt: (v) => this.onFacilityBuilt(v),
    });
    this.washView = new WashView(lotArgs(this.wash, { x: -60, z: 0 }, this.road.washEdge));
    this.garageView = new GarageView(lotArgs(this.garage, { x: 0, z: -60 }, this.road.garageEdge));
    // M7: district permits, charging hubs on purchasable lots, property catalog, decoration placement
    this.districts = new DistrictManager({ bus: this.bus, economy: this.economy, cfg: svcCfg.districts, getStage: () => this.progression.stage, scene: this.sm.scene, saved: saved?.districts });
    this.hubs = {};
    this.hubViews = {};
    for (const [key, hubCfg] of Object.entries(svcCfg.hubs)) {
      const prop = svcCfg.properties.find((p) => p.hub === key);
      const acc = this.road.lotAccess[key];
      const hub = new ChargingHub({ ...svcArgs, key, hubCfg, simScale: econCfg.simTimeScale, getTariff: () => this.power.tariffNow, saved: saved?.hubs?.[key] });
      hub.districtOk = () => this.districts.isUnlocked(prop.district);
      this.hubs[key] = hub;
      this.hubViews[key] = new HubView({ ...lotArgs(hub, { x: prop.ix * 60, z: prop.iz * 60 }, acc.edge), rot: acc.rot, spawnEdge: acc.spawn });
    }
    this.properties = new PropertyManager({ bus: this.bus, economy: this.economy, cfg: svcCfg.properties, hubs: this.hubs, wash: this.wash, garage: this.garage, districts: this.districts, getStage: () => this.progression.stage });
    this.placement = new PlacementManager({ bus: this.bus, economy: this.economy, cfg: decorCfg, saved: saved?.decor });
    const blockedBy = (getNav) => (wx, wz) => { const nav = getNav(); if (!nav) return false; const [cx, cz] = nav.toCell(wx, wz); return nav.isBlocked(cx, cz); };
    this.placement.registerLot({ id: 'station', label: 'Charging Station', built: () => true, forbidden: STATION_FORBIDDEN, rot: 0, blocked: blockedBy(() => this.nav), toWorld: (x, z) => ({ x, z }), toLocal: (x, z) => ({ x, z }) });
    const lotViews = [['wash', this.washView, this.wash], ['garage', this.garageView, this.garage], ...Object.entries(this.hubViews).map(([k, v]) => [v.id, v, this.hubs[k]])];
    for (const [id, view, biz] of lotViews) {
      this.placement.registerLot({ id, label: biz.cfg.label, built: () => biz.built, forbidden: SERVICE_FORBIDDEN, rot: view.rot, blocked: blockedBy(() => view.nav), toWorld: (x, z) => view.W(x, z), toLocal: (x, z) => view.Lc(x, z) });
    }
    this.customers.satisfactionBonus = () => this.employees.satisfactionBonus;
    this.contracts = new ContractManager({
      bus: this.bus, economy: this.economy, cfg: progCfg.contracts, progression: this.progression, saved: saved?.contracts,
      getBuilt: (k) => (k === 'wash' ? this.wash.built : this.garage.built),
    });
    this.upgrades = new UpgradeManager({ economy: this.economy, station: this.station, wash: this.wash, garage: this.garage, hub: this.hub, progression: this.progression, hubs: this.hubs });
    const stage = () => this.progression.stage;
    this.customers.getStage = stage;
    this.customers.fleetBoost = () => this.contracts.boostFor('charge');
    this.customers.patienceMult = () => this.hub.patienceMult;
    this.customers.hubBonus = (c) => this.hub.satisfactionBonus(c);
    this.customers.decorBonus = () => this.placement.effects('station').comfort;
    this.customers.decorDemand = () => this.placement.demandFactor('station', this.day?.hour ?? 12);
    for (const [biz, kind] of [[this.wash, 'wash'], [this.garage, 'garage'], ...Object.values(this.hubs).map((h) => [h, 'charge'])]) {
      biz.getStage = stage;
      biz.fleetBoost = () => this.contracts.boostFor(kind);
      biz.patienceMult = () => this.hub.patienceMult;
      biz.hubBonus = (c) => this.hub.satisfactionBonus(c);
      biz.decorBonus = () => this.placement.effects(biz.id).comfort;
      biz.decorDemand = () => this.placement.demandFactor(biz.id, this.day?.hour ?? 12);
    }
    this.chargingTasks = new ChargingTasks({ bus: this.bus, station: this.station, customers: this.customers, tasks: this.tasks, employees: this.employees, cfg: empCfg });
    this.employeeView = new EmployeeView({ scene: this.sm.scene, assets: this.assets, manager: this.employees, economy: this.economy, bus: this.bus });
    this.interaction = new InteractionSystem(this.bus, this.sm.scene);
    for (const t of this.stationView.interactables) this.interaction.add(t);
    this.addPropertyTargets();
    this.washView.init();
    this.garageView.init();
    for (const v of Object.values(this.hubViews)) v.init();
    await tick();

    step(0.8, 'Bringing the city to life…');
    this.day = new DayNight(this.sm, this.bus);
    if (saved?.time) { this.day.hour = saved.time.hour; this.day.day = saved.time.day; this.day.apply(); }
    this.camera = new CameraManager({
      camera: this.sm.camera, sceneFog: this.sm.scene.fog, bus: this.bus, input: this.input, player: this.player, colliders: this.colliders, settings: this.settings,
    });
    this.camera.tp.yaw = 0; // fixed street-view angle (never taken from the character's facing, so it is the same every launch)
    if (saved?.camera) this.camera.restore(saved.camera);
    this.goals = new GoalManager({
      bus: this.bus, economy: this.economy, stats: this.stats, cfg: missCfg, progression: this.progression, saved: saved?.goals,
      ctx: { washBuilt: () => this.wash.built, garageBuilt: () => this.garage.built, employees: () => this.employees.employees.filter((e) => !e.leaving).length, properties: () => this.properties.ownedCount, decor: () => this.placement.totalPlaced },
    });
    this.goals.init(this.day.day);
    this.contracts.day = this.day.day;
    this.ads = new AdService();
    this.offline = new OfflineManager({
      bus: this.bus, economy: this.economy, capHours: econCfg.offlineCapHours, saved: saved?.offline,
      getPayroll: () => this.employees.dailyPayroll,
      getUpkeep: () => (this.wash.built ? this.wash.unlockedBays * this.wash.cfg.upkeepPerBayPerDay : 0) + (this.garage.built ? this.garage.unlockedBays * this.garage.cfg.upkeepPerBayPerDay : 0),
      hasAutomation: () => this.employees.employees.some((e) => e.role === 'attendant' && !e.leaving),
    });
    this.dailyReward = new DailyReward({ economy: this.economy, cfg: progCfg.login, saved: saved?.login });
    if (!saved) this.dailyReward.markToday();
    this.missions = new MissionManager(this.bus, this.economy);
    this.missions.have = { employees: () => this.employees.employees.filter((e) => !e.leaving).length };
    if (saved?.missions) this.missions.restore(saved.missions);
    this.missions.syncCurrent();

    // selection ring (management mode)
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.8, 48),
      new THREE.MeshBasicMaterial({ color: 0x39ffb0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.sm.scene.add(this.selectionRing);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.34);
    this.decor = new DecorSystem({ scene: this.sm.scene, bus: this.bus, placement: this.placement, camera: this.sm.camera, groundPlane: this.groundPlane, touch: this.touch });
    this.moveMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.55, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.moveMarker.rotation.x = -Math.PI / 2;
    this.moveMarker.visible = false;
    this.sm.scene.add(this.moveMarker);

    this.ui = new UIManager({
      bus: this.bus, economy: this.economy, station: this.station, missions: this.missions,
      settings: this.settings, game: this, camera: this.camera, day: this.day, customers: this.customers, employees: this.employees, wash: this.wash, garage: this.garage,
      stats: this.stats, progression: this.progression, goals: this.goals, upgrades: this.upgrades, hub: this.hub, contracts: this.contracts,
      power: this.power, ads: this.ads, offline: this.offline, dailyReward: this.dailyReward,
      properties: this.properties, districts: this.districts, hubs: this.hubs, hubViews: this.hubViews, placement: this.placement, decor: this.decor,
    });
    this.wireEvents();
    this.bus.emit('mission:progress', this.missions.snapshot());

    step(1, 'Ready!');
    await tick();
    $('hud').classList.remove('hidden');
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 700);
    playerYield.pos = this.player.pos;
    this.tutorial = new TutorialManager({ game: this, bus: this.bus, scene: this.sm.scene, saved: saved?.tutorial, isNew: !saved });
    // welcome back: offline earnings first, then the daily login reward
    this.pendingOffline = saved?.lastSeen ? this.offline.compute((Date.now() - saved.lastSeen) / 1000) : null;
    if (this.pendingOffline) this.ui.open('offline');
    else if (this.dailyReward.status()) this.ui.open('login');

    this.timer = new THREE.Timer();
    this.time = 0;
    this.autosave = 0;
    this.fps = { n: 0, t: 0, v: 0 };
    this.sm.renderer.setAnimationLoop(() => this.frame());
    addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    addEventListener('beforeunload', () => this.save());
    window.__game = this; // debugging / automated tests
  }

  addPropertyTargets() {
    for (const p of this.city.properties) {
      const pos = new THREE.Vector3(p.x, 0, p.z + 16);
      const entry = this.properties.get(p.facility);
      const biz = entry?.biz;
      if (biz) p.biz = biz;
      this.interaction.add({
        id: p.id, pos, radius: 4,
        getPrompt: () => {
          if (!entry) return { text: `${p.category} · ${money(p.price)}` };
          const i = this.properties.info(entry);
          if (i.owned) return null;
          if (i.reason) return { text: `${i.name} · ${i.reason}` };
          return { text: `Buy ${i.name} · ${money(i.price)}`, auto: false };
        },
        run: () => {
          if (!entry) return;
          const r = this.properties.buy(entry.id);
          this.bus.emit('toast', { text: r.ok ? `${biz.cfg.label} is yours! Hire staff to run it.` : r.reason, kind: r.ok ? 'good' : '' });
        },
      });
    }
  }

  /** A facility lot was built (or restored from the save): hide its "for sale" props, add its interaction targets. */
  onFacilityBuilt(view) {
    const p = this.city.properties.find((x) => x.facility === view.id);
    if (p) { p.owned = true; p.sale.visible = false; }
    for (const t of view.interactables) this.interaction.add(t);
    if (view.nav) this.nav = this.nav || view.nav;
  }

  /** Customers who finished charging may drive on to the wash or garage. */
  maybeRefer({ customer: c }) {
    const v = c?.vehicle;
    if (!v || v.dirt === undefined) return;
    const boost = c.type === 'premium' || c.type === 'vip' ? 1.5 : 1;
    if (this.wash.built && v.dirt > 0.35 && Math.random() < this.wash.cfg.referralChance * boost) this.wash.refer(v, c.type);
    const worn = Math.min(...Object.values(v.condition));
    if (this.garage.built && worn < 55 && Math.random() < this.garage.cfg.referralChance * 2) this.garage.refer(v, c.type);
  }

  wireEvents() {
    const b = this.bus;
    b.on('camera:mode', (m) => {
      this.player.enabled = m === 'third';
      const mg = m === 'management';
      this.stationView.setManagementMode(mg);
      this.employeeView.setManagementMode(mg);
      this.washView.setManagementMode(mg);
      this.garageView.setManagementMode(mg);
      for (const v of Object.values(this.hubViews)) v.setManagementMode(mg);
      if (!mg) this.decor.cancel();
      if (m === 'management') this.camera.focusOn(this.player.pos);
    });
    b.on('input:click', (e) => this.onClick(e));
    b.on('customer:paid', (e) => this.maybeRefer(e));
    b.on('day:new', () => {
      this.employees.paySalaries(); // salaries are booked before the daily report closes
      this.wash.dailyUpkeep();
      this.garage.dailyUpkeep();
      for (const h of Object.values(this.hubs)) h.dailyUpkeep();
      this.properties.dailyCosts();
      this.power.flush(this.economy);
      this.power.resetDay();
      this.contracts.newDay(this.day.day);
      this.goals.newDay(this.day.day);
      this.economy.settleDay(this.day.day - 1);
      this.station.todayServed = 0;
    });
    this._lastSel = null;
  }

  /** Management-mode picking. */
  onClick({ x, y, button }) {
    if (button !== 0 || this.paused || this.camera.transitioning) return;
    if (this.decor.active) { this.decor.pointer(x, y, true); return; }
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.sm.camera);
    if (!this.camera.inManagement) {
      // street view: clicking a charger that is charging stops the charge (walk up to it first if needed)
      const ch = this.raycaster.intersectObjects(this.stationView.bayVis.map((v) => v.charger), true)[0];
      if (ch) {
        let o = ch.object; while (o && o.userData.bayIndex === undefined) o = o.parent;
        const i = o?.userData.bayIndex;
        const b = i !== undefined ? this.station.bays[i] : null;
        if (b && b.state === 'charging') {
          const cx = o.userData.bayX;
          if (Math.hypot(cx - this.player.pos.x, this.player.pos.z) <= 4.2) { this.pendingStop = null; this.station.stopCharging(i); }
          else {
            this.pendingStop = i;
            this.player.target = { x: cx + (this.player.pos.x < cx ? -2.2 : 2.2), z: 1.2 };
            this.player.stuckT = 0; this.player.stuckX = this.player.pos.x; this.player.stuckZ = this.player.pos.z;
          }
          return;
        }
      }
      this.pendingStop = null;
      // street view: click / tap the ground to walk there
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
        this.player.target = { x: THREE.MathUtils.clamp(hit.x, -150, 150), z: THREE.MathUtils.clamp(hit.z, -150, 150) };
        this.player.stuckT = 0; this.player.stuckX = this.player.pos.x; this.player.stuckZ = this.player.pos.z;
        this.moveMarker.position.set(this.player.target.x, 0.4, this.player.target.z);
        this.moveMarker.visible = true;
        this.moveMarker.scale.setScalar(1);
      }
      return;
    }
    const roots = [...this.employeeView.selectables, ...this.stationView.selectables, ...this.washView.selectables, ...this.garageView.selectables, ...Object.values(this.hubViews).flatMap((v) => v.selectables)].filter((o) => o.visible);
    const hits = this.raycaster.intersectObjects(roots, true);
    if (!hits.length) { this.ui.clearSelection(); return; }
    let o = hits[0].object;
    while (o && !o.userData.select) o = o.parent;
    if (!o) return;
    const focus = o.userData.focus;
    this.selectionRing.position.set(focus.x, 0.45, focus.z);
    this.selectionRing.visible = true;
    this.ui.showSelection(o.userData.select);
  }

  /** Street view, mouse: hold the left button and drag — the character keeps walking towards the cursor; release to stop. */
  dragMove() {
    const p = !this.camera.inManagement && !this.camera.transitioning && !this.decor.active ? this.input.mouseHold() : null;
    if (!p) {
      if (this.holdMoving) { this.holdMoving = false; this.player.target = null; }
      return;
    }
    const ndc = new THREE.Vector2((p.x / innerWidth) * 2 - 1, -(p.y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.sm.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
    this.holdMoving = true;
    this.player.target = { x: THREE.MathUtils.clamp(hit.x, -150, 150), z: THREE.MathUtils.clamp(hit.z, -150, 150) };
    this.moveMarker.position.set(this.player.target.x, 0.4, this.player.target.z);
    this.moveMarker.visible = true;
  }

  setPaused(p) {
    this.paused = p;
    this.input.enabled = !p;
  }

  applyQuality() {
    this.sm.applyQuality();
    this.city.treeMeshes?.forEach((m) => { if (m.isInstancedMesh && m.geometry.type === 'IcosahedronGeometry') m.castShadow = this.settings.quality.treeShadows; });
    this.ui.toast('Quality: ' + this.settings.data.quality + ' (traffic density applies after restart)');
  }

  frame() {
    this.frameCount = (this.frameCount || 0) + 1;
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.time += dt;
    this.input.update();
    if (!this.paused) {
      this.day.update(dt);
      this.customers.update(dt);
      this.station.update(dt);
      this.hub.update(dt);
      this.progression.update(dt);
      this.goals.update(dt);
      this.offline.update(dt);
      this.chargingTasks.update(dt);
      this.wash.update(dt);
      this.garage.update(dt);
      for (const h of Object.values(this.hubs)) h.update(dt);
      this.districts.update(dt, this.camera.inManagement ? this.camera.mg.dist / 120 : 1);
      this.decor.update();
      this.employees.update(dt);
      for (const v of [this.washView, this.garageView, ...Object.values(this.hubViews)]) {
        v.mgFactor = this.camera.mg.dist / 120;
        v.playerPos = this.player.pos;
        v.update(dt);
      }
      this.employeeView.mgFactor = this.camera.mg.dist / 120;
      this.employeeView.update(dt);
      this.stationView.mgFactor = this.camera.mg.dist / 120;
      this.stationView.update(dt, this.player.pos);
      this.dragMove();
      this.player.update(dt, this.camera.moveYaw);
      this.traffic.update(dt, this.camera.focusPoint);
      this.lights.update();
      this.peds.update(dt, this.camera.focusPoint);
      this.interaction.enabled = !this.camera.inManagement;
      this.interaction.update(this.player.pos, this.time, dt, this.player.speed);
      if (this.pendingStop != null) { // walked up to a charger that was clicked: stop its charge on arrival
        const i = this.pendingStop, b = this.station.bays[i], cx = this.stationView.bayVis[i].charger.userData.bayX;
        if (!b || b.state !== 'charging') this.pendingStop = null;
        else if (Math.hypot(cx - this.player.pos.x, this.player.pos.z) <= 4.0) { this.pendingStop = null; this.station.stopCharging(i); }
      }
      if (this.moveMarker.visible) {
        if (!this.player.target) this.moveMarker.visible = false;
        else this.moveMarker.scale.setScalar(1 + Math.sin(this.time * 8) * 0.12);
      }
      this.city.update(this.camera.focusPoint, this.time, this.camera.inManagement ? this.camera.mg.dist / 120 : 1);
      this.autosave += dt;
      if (this.autosave > 15) { this.autosave = 0; this.save(); }
    }
    this.camera.update(dt);
    if (this.selectionRing.visible) {
      const s = (1 + Math.sin(this.time * 4) * 0.06) * Math.max(1, this.camera.mg.dist / 120);
      this.selectionRing.scale.set(s, s, s);
    }
    this.sm.updateShadowFocus(this.camera.focusPoint);
    this.sm.env.update(dt, this.sm.camera.position, this.camera.focusPoint);
    this.ui.setLocation(this.city.districtAt(this.player.pos.x, this.player.pos.z));
    this.ui.update(dt);
    this.tutorial?.update(dt);
    this.sm.render();
    this.fps.n++; this.fps.t += dt;
    if (this.fps.t >= 1) { this.fps.v = this.fps.n / this.fps.t; this.fps.n = 0; this.fps.t = 0; }
  }

  collect() {
    return {
      player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      economy: this.economy.serialize(),
      station: this.station.serialize(),
      customers: this.customers.serialize(),
      employees: this.employees.serialize(),
      wash: this.wash.serialize(),
      garage: this.garage.serialize(),
      districts: this.districts.serialize(),
      hubs: Object.fromEntries(Object.entries(this.hubs).map(([k, h]) => [k, h.serialize()])),
      decor: this.placement.serialize(),
      stats: this.stats.serialize(),
      progression: this.progression.serialize(),
      goals: this.goals.serialize(),
      hub: this.hub.serialize(),
      contracts: this.contracts.serialize(),
      offline: this.offline.serialize(),
      login: this.dailyReward.serialize(),
      missions: this.missions.serialize(),
      tutorial: this.tutorial?.serialize(),
      camera: this.camera.serialize(),
      time: { hour: this.day.hour, day: this.day.day },
      lastSeen: Date.now(),
    };
  }

  save() {
    if (this.resetting) return Promise.resolve();
    this.lastSaved = Date.now();
    return this.saver.save(this.collect());
  }

  /** Fast travel from the city map: put the player at a spot and snap the camera there. */
  travelTo(x, z) {
    this.player.pos.set(x, 0.34, z);
    this.player.target = null;
    this.player.vel.set(0, 0, 0);
    this.camera.tp.smooth.set(x, 1.9, z);
    this.camera.mg.focus.set(x, 0, z);
    this.bus.emit('toast', { text: 'Travelled across the city' });
  }

  /** Collect the offline report; withAd shows the (optional) rewarded ad and doubles the net earnings. */
  async claimOffline(withAd) {
    const r = this.pendingOffline;
    if (!r) return;
    let mult = 1;
    if (withAd) mult = (await this.ads.showRewarded('offline-2x')) ? 2 : 1;
    this.offline.apply(r, mult);
    this.pendingOffline = null;
    this.ui.toast(mult > 1 ? 'Doubled offline earnings collected!' : 'Offline earnings collected', 'good');
    this.ui.closeModal();
  }

  async resetSave() {
    this.resetting = true;
    await this.saver.clear();
    location.reload();
  }
}
