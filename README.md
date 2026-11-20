# EV City Tycoon

3D open-city EV business tycoon (Three.js + Vite, ES modules). Design baseline: `gdd/EV_City_Tycoon_GDD_v1.pdf`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

> If this folder lives on a cloud drive that cannot hold `node_modules` (Google Drive), install the
> dependencies in a local folder and point Vite at them:
> `set EVCT_DEPS=C:\dev\evct-deps` (folder containing `node_modules`), then run
> `node %EVCT_DEPS%\node_modules\vite\bin\vite.js "<this folder>"`.
> On such drives Vite's file watcher can miss files written by scripts: restart the dev server if you see stale behaviour.

## Controls

| | Desktop | Mobile |
|-|-|-|
| Move | WASD / arrows, or click the ground (Shift sprint) | Joystick, or tap the ground |
| Camera | Fixed high-angle follow camera, wheel zoom | Pinch |
| Interact | Stand next to a bay (cars connect by themselves); click a charging charger to stop and bill; click the floating Open button at the terminal | Same, by tapping |
| Management (isometric) camera | M | Manage button; ↺ ↻ rotate 90° |
| Menu | Esc | ⚙️ |

## Game systems (milestones 1-6)

- **Charging station** (grid power, throttling, efficiency, solar, battery, time-of-day tariffs), **customers** (6 types, queue, patience, satisfaction, tips, reputation), **employees** (TaskManager, pathfinding, hire/fire/train, salaries), **car wash** and **EV garage** (staged animations, parts inventory), **customer hub** (store, coffee shop, lounge), **fleet contracts**.
- **Progression**: 4 stages with goals, rewards and feature unlocks; main missions, daily missions, weekly challenges, achievements.
- **Economy**: single EconomyManager for every money movement, daily report + 14-day history, offline earnings (4 h cap, optional rewarded-ad 2x), daily login reward.

## Structure

```
src/core        EventBus, Game (composition root), SceneManager, AssetManager, Input, SaveManager, Settings, AdService
src/world       CityManager, RoadManager (lane graph + signals), TrafficManager, Pedestrians, Models/Materials, DayNight, Particles
src/camera      CameraManager (street follow camera + isometric management camera)
src/player      PlayerController, InteractionSystem
src/businesses  ChargingStation, PowerSystem, ServiceBusiness -> CarWash, Garage, ServiceHub, views (Station/ServiceLot/Wash/Garage)
src/customers   CustomerManager
src/employees   TaskManager, EmployeeManager (AI), NavGrid (A*), ChargingTasks, EmployeeView
src/vehicles    PathFollower, ParkingSystem, VehicleState
src/economy     EconomyManager, UpgradeManager, ContractManager, RetentionManager (offline + login)
src/progression StatsTracker, ProgressionManager, GoalManager, MissionManager
src/ui          UIManager (HTML/CSS overlay)
public/data     economy, vehicles, customers, employees, services, progression, missions (JSON), assets.json (GLB manifest)
```

Drop Blender GLBs into `public/assets/models/` and list them in `public/data/assets.json`
(`{"models":[{"name":"car","url":"./assets/models/car.glb"}]}`) to replace the procedural models.

## Testing

```bash
npm test          # 90+ automated unit / UI tests (Vitest; logic in Node, UI in jsdom) - runs in about 2 seconds
npm run test:watch
npm run test:e2e  # browser tests: needs `npm run dev` running and a Chromium-based browser
                  #   EVCT_BROWSER=path/to/chrome-or-edge  EVCT_URL=http://localhost:5173/
```

- `tests/` covers customer counting (no double counting), economy and payments (no duplicate payments), charging bay reservation / release, customer lifecycle, property purchases, employee task assignment, tutorial targets / pause / resume, the Statistics panel and in-place panel refresh, and save / load.
- `e2e/` drives the real game in a browser: HUD, tutorial hints, every management panel, buttons and keyboard focus (desktop + touch), building selection.
- CI (`.github/workflows/pages.yml`) runs `npm test` before building.