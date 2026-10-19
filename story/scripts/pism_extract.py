"""Grounded-ice outlines through time from the PISM reference simulation of Kingslake et al. (2018).

Data: Albrecht, T. (2018) PISM simulation results of the Antarctic Ice Sheet deglaciation.
GFZ Data Services. https://doi.org/10.5880/PIK.2018.008 (CC BY 4.0). Unzip data_pism_rebound.zip
and pass the `datapub` folder to prepare_data.py as `pism=/path/to/datapub`.

The reference experiment is 2205. Its mask file holds the PISM mask every 100 years from 34,850
to 50 years before present on a 15 km grid (2 = grounded, 3 = floating, 4 = ocean). The x and y
in that file are offset by up to 5 km from EPSG:3031, so the coordinates are taken from the
bootstrap file, whose x and y agree with its own lat/lon.
"""

import json
from pathlib import Path

import numpy as np

REGION = (-2000, -1700, 800, 1500)  # km: West Antarctica, Weddell and Ross sectors
STEP_YR = 200
START_YR = -20000
MIN_YR = -10200
DRILL_KM = (-955.19, 545.99)
HIR_KM = (-910, 500)  # inside the present-day ice rise


def rings_from_mask(mask, x_km, y_km, upsample=3, tol_km=2.0):
    """Closed outlines of a boolean mask, smoothed, as flat [x0, y0, x1, y1, ...] lists in km."""
    from contourpy import contour_generator
    from scipy.ndimage import gaussian_filter, zoom
    from shapely.geometry import LineString

    p = np.pad(mask.astype(np.float32), 1)
    m = zoom(p, upsample, order=1)
    m = gaussian_filter(m, 0.6 * upsample)
    dx = x_km[1] - x_km[0]
    dy = y_km[1] - y_km[0]
    # zoom maps output sample k to padded input sample k (n - 1) / (N - 1); the pad adds one cell
    gx = x_km[0] + (np.arange(m.shape[1]) * (p.shape[1] - 1) / (m.shape[1] - 1) - 1) * dx
    gy = y_km[0] + (np.arange(m.shape[0]) * (p.shape[0] - 1) / (m.shape[0] - 1) - 1) * dy
    out = []
    for xy in contour_generator(gx, gy, m).lines(0.5):
        if len(xy) < 4:
            continue
        ls = LineString(xy).simplify(tol_km)
        if ls.length < 40:
            continue
        out.append(np.round(np.asarray(ls.coords), 1).ravel().tolist())
    return out


def extract(datapub, out_dir, gl_path):
    import xarray as xr

    datapub = Path(datapub)
    run = datapub / "model_data/forcing2205_LGM/results/extra_forcing_15km_205000yrs_mask.nc"
    boot = datapub / "model_data/pism_boot/result_boot_15km_obs.nc"
    ex = xr.open_dataset(run, decode_times=False)
    ob = xr.open_dataset(boot, decode_times=False)
    x_km = ob.x.values / 1000
    y_km = ob.y.values / 1000
    t_yr = ex.time.values / (365.0 * 24 * 3600)

    jx = np.where((x_km >= REGION[0]) & (x_km <= REGION[2]))[0]
    iy = np.where((y_km >= REGION[1]) & (y_km <= REGION[3]))[0]
    xs, ys = x_km[jx], y_km[iy]

    # Weddell sector (as in the paper's plot scripts: longitude between -90 and 0)
    lon = ob["lon"].values[np.ix_(iy, jx)]
    weddell = (lon >= -90) & (lon <= 0)

    frames = [k for k, t in enumerate(t_yr) if t >= START_YR - 1 and (round(t + 50) % STEP_YR == 0)]
    if frames[-1] != len(t_yr) - 1:
        frames.append(len(t_yr) - 1)

    mask_all = ex["mask"].values[:, iy][:, :, jx]
    grounded_all = mask_all == 2
    area_w = (grounded_all & weddell).sum(axis=(1, 2)) * 15.0**2
    # The paper (Fig. 3) gives the simulated Weddell Sea minimum, found along a transect, as 10.2 kyr BP
    kmin = int(np.argmin(np.abs(t_yr - MIN_YR)))

    # How much of today's Henry Ice Rise footprint is grounded in the model at each time
    import geopandas as gpd
    from shapely.geometry import Point

    gl = gpd.read_file(gl_path).to_crs(3031).geometry.union_all()
    hir = next(g for g in gl.geoms if g.contains(Point(HIR_KM[0] * 1e3, HIR_KM[1] * 1e3)))
    cells = [(i, j) for i in range(len(ys)) for j in range(len(xs)) if hir.contains(Point(xs[j] * 1e3, ys[i] * 1e3))]
    hir_frac = np.array([np.mean([grounded_all[k, i, j] for i, j in cells]) for k in range(len(t_yr))])
    print(f"  {len(cells)} model cells inside Henry Ice Rise")

    out = {
        "source": "Kingslake et al. 2018, PISM reference simulation 2205 (Albrecht 2018, doi:10.5880/PIK.2018.008)",
        "times": [round(float(t_yr[k])) for k in frames],
        "grounded": [rings_from_mask(grounded_all[k], xs, ys) for k in frames],
        "ice": [rings_from_mask(mask_all[k] <= 3, xs, ys, tol_km=3.0) for k in frames],
        "min_time": round(float(t_yr[kmin])),
        "min_grounded": rings_from_mask(grounded_all[kmin], xs, ys),
        "weddell_area_km2": [int(area_w[k]) for k in frames],
        "hir_grounded_fraction": [round(float(hir_frac[k]), 2) for k in frames],
    }
    path = Path(out_dir) / "pism.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  wrote {path} ({path.stat().st_size / 1e3:.0f} kB), {len(frames)} frames")
