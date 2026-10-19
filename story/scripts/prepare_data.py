"""Build the web assets for the PHIRE scroll story and video from local data.

Run with the `phire` conda env from the repo root:

    python story/scripts/prepare_data.py            # every step
    python story/scripts/prepare_data.py radar pism # only some steps

Each step reads data that is not in the repo (Quantarctica, the DELORES radar
files, the WorldView scene, the PISM output of Kingslake et al. 2018) from the
paths in PATHS, and writes small files to story/assets/. The assets are
committed, so the story can be served without rerunning this script.

All map coordinates are EPSG:3031 (polar stereographic), written in kilometres.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = HERE.parent / "assets"
OUT.mkdir(exist_ok=True)

Q = Path("/Users/jkingslake/Documents/science/QGIS/Quantarctica3")
HF = Path("/Users/jkingslake/Documents/papers/WAIS_readvance_Kingslake/files_from_dell_machine/1/HenryFormation")
FIELD = Path("/Users/jkingslake/Documents/data/ronne_fieldwork")
PATHS = {
    "lima": Q / "SatelliteImagery/LIMA/LIMA_CIRREF.vrt",
    "moa": Q / "SatelliteImagery/MODIS/MODIS_Mosaic.tif",
    "speed": Q / "Glaciology/MEaSUREs Ice Flow Velocity/MEaSUREs_IceFlowSpeed_450m.tif",
    "gl": Q / "Glaciology/MEaSUREs Antarctic Boundaries/GroundingLine_Antarctica_v2.shp",
    "coast": Q / "Glaciology/MEaSUREs Antarctic Boundaries/Coastline_Antarctica_v2.shp",
    "worldview": Path(
        "/Users/jkingslake/Documents/projects/proposals/other/PHIRE/proposal/fridge_1479_jkingslake/ortho/"
        "WV01_20250228140506_102001010D9E6800_25FEB28140506-P1BS-509390623020_01_P007_u08rf3031.tif"
    ),
    "season_dirs": {
        "2013/14": FIELD / "FieldData_13_14_old/DELORES",
        "2014/15": FIELD / "FieldData_14_15_old/DELORES",
    },
    # Season 1 discovery line: north-west along the ridge on 9 January 2014, the last day of the survey,
    # ending in the corner where the relic crevasses were first seen (ReflexW SEG-Y export)
    "ridge_sgy": FIELD / "FieldData_13_14_old/DELORES/HE/HENorthAlongRidge_1/ASCII/HENORTHALONGRIDGE.SGY",
    "ridge_pos": FIELD / "FieldData_13_14_old/DELORES/HE/HENorthAlongRidge_1/HENorthAlongRidge_1positions_polar.dat",
    # Season 2 line through the drill site, as in preliminary-planning/HIR_radargram_plotting.ipynb
    "fl5_radargram": HF / "HENORTH_FL5/FinalRadargramForPublication/HENORTH_FL5_2.ASC",
    "fl5_pos": HF / "HEnorth_FL5/FinalRadargramForPublication/DBPosFL15.dst",
    "crevasse_boundary": HF / "Figures/Boundary_of_basal_crevasses.txt",
    "texture_line": HF / "HE_surf_text_line_2.shp",
    "drillsite": REPO / "preliminary-planning/drillsite_gdf.geojson",
    "grounding_sensitivity": REPO / "preliminary-planning/grounding_time_sensitivity.nc",
    "pism_dir": None,  # set from the command line: pism=/path/to/unzipped/data_pism_rebound
}

# Radar constants, as in HIR_radargram_plotting.ipynb
V_ICE = 168e6
SAMPLE_TO_DIST = V_ICE / 250e6 / 2  # metres of depth per sample


def km(a):
    return np.round(np.asarray(a, dtype=float) / 1000.0, 3)


def save_json(name, obj):
    path = OUT / name
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  wrote {path.relative_to(REPO)} ({path.stat().st_size / 1e3:.0f} kB)")


def save_webp(name, rgba, quality=82):
    from PIL import Image

    mode = "RGBA" if rgba.shape[2] == 4 else "RGB"
    img = Image.fromarray(np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8), mode)
    path = OUT / name
    img.save(path, "WEBP", quality=quality, method=6)
    print(f"  wrote {path.relative_to(REPO)} {img.size} ({path.stat().st_size / 1e3:.0f} kB)")


# --------------------------------------------------------------------------------------
# Basemaps
# --------------------------------------------------------------------------------------

# One colour grade for every imagery layer, so nested layers blend without seams.
GRADE_DARK = np.array([0.035, 0.055, 0.090])
GRADE_LIGHT = np.array([0.80, 0.86, 0.91])


def read_grid(path, bounds_km, res_m, bands=None, resampling="average"):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    b = [v * 1000 for v in bounds_km]
    width = int(round((b[2] - b[0]) / res_m))
    height = int(round((b[3] - b[1]) / res_m))
    with rasterio.open(path) as src:
        idx = bands or list(range(1, src.count + 1))
        out = np.zeros((len(idx), height, width), np.float32)
        # Read only the part inside the raster: boundless reads go through a warped VRT that
        # ignores overviews, which makes continent-scale reads of the 15 m LIMA mosaic very slow.
        ib = (max(b[0], src.bounds.left), max(b[1], src.bounds.bottom), min(b[2], src.bounds.right), min(b[3], src.bounds.top))
        if ib[0] >= ib[2] or ib[1] >= ib[3]:
            return out
        c0 = int(round((ib[0] - b[0]) / res_m))
        c1 = int(round((ib[2] - b[0]) / res_m))
        r0 = int(round((b[3] - ib[3]) / res_m))
        r1 = int(round((b[3] - ib[1]) / res_m))
        out[:, r0:r1, c0:c1] = src.read(
            idx,
            window=from_bounds(*ib, src.transform),
            out_shape=(len(idx), r1 - r0, c1 - c0),
            resampling=getattr(Resampling, resampling),
        )
    return out


def grade(lum, chroma=None, local_sigma_px=None, local_amount=0.0):
    """Map a 0-1 luminance image (plus optional colour deviations) to the story palette."""
    from scipy.ndimage import gaussian_filter

    v = lum
    if local_sigma_px:
        v = v + local_amount * (v - gaussian_filter(v, local_sigma_px))
    v = np.clip(v, 0, 1)
    rgb = GRADE_DARK + (GRADE_LIGHT - GRADE_DARK) * v[..., None]
    if chroma is not None:
        rgb = rgb + 0.8 * chroma
    return np.clip(rgb, 0, 1)


_MOA_LUT = None


def moa_to_lima(moa):
    """Map MOA values to the graded LIMA luminance, by matching the two where both exist near the pole hole."""
    global _MOA_LUT
    if _MOA_LUT is None:
        b = (-1000, -1000, 1000, 1000)
        lima = read_grid(PATHS["lima"], b, 4000) / 255.0
        m = read_grid(PATHS["moa"], b, 4000)[0]
        lum = 0.3 * lima[0] + 0.55 * lima[1] + 0.15 * lima[2]
        lum = np.clip((lum - 0.60) / (0.95 - 0.60), 0, 1) ** 1.5
        ok = (lima.max(axis=0) > 0.3) & (m > 20)
        lut = np.zeros(256, np.float32)
        vals = np.arange(256)
        med = np.array([np.median(lum[ok & (m == v)]) if (ok & (m == v)).sum() > 30 else np.nan for v in vals])
        good = np.isfinite(med)
        lut[:] = np.interp(vals, vals[good], med[good])
        _MOA_LUT = lut
    return _MOA_LUT[np.clip(moa, 0, 255).astype(int)]


def imagery_layer(bounds_km, res_m, local_sigma_km=None, local_amount=0.0, feather=0.0):
    """LIMA true-colour mosaic, with MOA filling LIMA's pole hole, graded and with ocean transparent."""
    from scipy.ndimage import gaussian_filter

    lima = read_grid(PATHS["lima"], bounds_km, res_m) / 255.0
    if res_m < 60:
        lima = gaussian_filter(lima, (0, 0.8, 0.8))
    moa = read_grid(PATHS["moa"], bounds_km, res_m)[0]
    has_lima = lima.max(axis=0) > 0.02
    has_moa = moa > 20
    lum_lima = 0.3 * lima[0] + 0.55 * lima[1] + 0.15 * lima[2]
    # LIMA ice sits between about 0.55 (shadowed mountains) and 0.97 (bright snow)
    lum = np.clip((lum_lima - 0.60) / (0.95 - 0.60), 0, 1) ** 1.5
    chroma = np.moveaxis(lima - lum_lima[None], 0, -1)
    # MOA (8-bit, ice mostly 55-70) fills the hole south of 82.5 S
    lum_moa = moa_to_lima(moa)
    # blend across the edge of LIMA's pole hole (LIMA's edge pixels are dark, so erode first)
    from scipy.ndimage import binary_erosion, distance_transform_edt

    has_lima = binary_erosion(has_lima, iterations=3)
    wl = np.clip(distance_transform_edt(has_lima) / 6.0, 0, 1)
    lum = np.where(has_moa, wl * lum + (1 - wl) * lum_moa, lum)
    chroma *= wl[..., None]
    sigma = local_sigma_km * 1000 / res_m if local_sigma_km else None
    rgb = grade(lum, chroma, sigma, local_amount)
    alpha = (has_lima | has_moa).astype(np.float32)
    if feather:
        alpha *= edge_ramp(alpha.shape, feather)
    return np.dstack([rgb, alpha])


def edge_ramp(shape, frac):
    h, w = shape
    ry = np.clip(np.minimum(np.arange(h), np.arange(h)[::-1]) / (frac * h), 0, 1)
    rx = np.clip(np.minimum(np.arange(w), np.arange(w)[::-1]) / (frac * w), 0, 1)
    r = np.minimum(ry[:, None], rx[None, :])
    return (r * r * (3 - 2 * r)).astype(np.float32)


def worldview_layer(bounds_km, res_m, feather=0.0, local_sigma_km=None, local_amount=0.0):
    from scipy.ndimage import gaussian_filter

    pan = read_grid(PATHS["worldview"], bounds_km, res_m, bands=[1])[0]
    valid = pan > 0
    pan = np.where(valid, gaussian_filter(pan, 0.6), 0)
    # match the mean brightness of the LIMA layer in the same box, with a little more texture
    lima = read_grid(PATHS["lima"], bounds_km, 15) / 255.0
    ll = np.clip((0.3 * lima[0] + 0.55 * lima[1] + 0.15 * lima[2] - 0.60) / 0.35, 0, 1) ** 1.5
    z = (pan - pan[valid].mean()) / pan[valid].std()
    lum = ll.mean() + np.clip(z, -4, 4) * max(ll.std(), 0.04) * 1.6
    sigma = local_sigma_km * 1000 / res_m if local_sigma_km else None
    rgb = grade(lum, None, sigma, local_amount)
    alpha = valid.astype(np.float32)
    if feather:
        from scipy.ndimage import distance_transform_edt

        # feather from the edge of the valid (rotated) footprint as well as the box edge
        d = distance_transform_edt(np.pad(valid, 1))[1:-1, 1:-1]
        alpha *= np.clip(d / (feather * max(pan.shape)), 0, 1)
        alpha *= edge_ramp(alpha.shape, feather)
    return np.dstack([rgb, alpha])


def speed_layer(bounds_km, res_m):
    """Ice speed as a translucent colour wash: transparent where slow, glowing where fast."""
    import matplotlib

    v = read_grid(PATHS["speed"], bounds_km, res_m, resampling="bilinear")[0]
    v[(v < 0) | (v > 1e5) | ~np.isfinite(v)] = 0
    s = np.clip((np.log10(np.maximum(v, 1)) - 1.0) / (np.log10(800) - 1.0), 0, 1)  # 10 -> 800 m/yr
    cmap = matplotlib.colormaps["magma"]
    rgb = cmap(0.35 + 0.6 * s)[..., :3]
    alpha = np.clip(s * 1.3, 0, 1) ** 0.8 * 0.85
    return np.dstack([rgb, alpha])


BASEMAPS = [
    # name, bounds (km), resolution (m), local contrast sigma (km), amount, edge feather
    ("base_ant", (-2900, -2500, 2900, 2500), 2000, None, 0.0, 0.0),
    ("base_weddell", (-1800, -300, -100, 1300), 500, 15, 0.6, 0.04),
    ("base_hir", (-1110, 370, -780, 610), 100, 6, 0.9, 0.05),
    ("base_hen", (-990, 515, -915, 575), 25, 2.0, 0.6, 0.08),
]


def step_basemaps():
    layers = []
    for name, b, res, sig, amt, feather in BASEMAPS:
        print(name)
        rgba = imagery_layer(b, res, sig, amt, feather)
        save_webp(f"{name}.webp", rgba, quality=80)
        layers.append({"name": name, "src": f"assets/{name}.webp", "bounds": b, "res_km": res / 1000})

    # WorldView-1, 28 Feb 2025: the HEnorth survey area, the drill site and the surface crevasses near the GL
    drill = drillsite_km()
    wv = [
        ("wv_drill", (drill[0] - 1.6, drill[1] - 1.6, drill[0] + 1.6, drill[1] + 1.6), 1.6, 0.08, 0.15, 1.0),
        ("wv_crev", (-951.6, 551.0, -950.0, 552.6), 0.8, 0.08, 0.1, 1.0),
    ]
    for name, b, res, feather, sig, amt in wv:
        print(name)
        rgba = worldview_layer(b, res, feather, sig, amt)
        save_webp(f"{name}.webp", rgba, quality=70)
        layers.append({"name": name, "src": f"assets/{name}.webp", "bounds": b, "res_km": res / 1000})

    print("speed")
    b = (-1800, -300, -100, 1300)
    save_webp("speed_weddell.webp", speed_layer(b, 1000), quality=80)
    speed = {"name": "speed_weddell", "src": "assets/speed_weddell.webp", "bounds": b, "res_km": 1.0}
    update_manifest(basemaps=layers, speed=speed)


# --------------------------------------------------------------------------------------
# Vectors: grounding line, coastline, labels, drill site, crevasse boundary
# --------------------------------------------------------------------------------------


def drillsite_km():
    import geopandas as gpd

    g = gpd.read_file(PATHS["drillsite"]).to_crs(3031).geometry.iloc[0]
    return [round(g.x / 1000, 3), round(g.y / 1000, 3)]


def rings(geom, min_len_km=0):
    """Exterior and interior rings of a (multi)polygon as lists of [x, y] in km."""
    out = []
    polys = getattr(geom, "geoms", [geom])
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            if ring.length / 1000 < min_len_km:
                continue
            xy = np.asarray(ring.coords)[:, :2] / 1000
            out.append(np.round(xy, 2).ravel().tolist())
    return out


def lines(geom, min_len_km=0):
    """Line parts of a geometry as lists of [x, y] in km."""
    out = []
    for g in getattr(geom, "geoms", [geom]):
        if g.geom_type in ("LineString", "LinearRing") and g.length / 1000 >= min_len_km:
            out.append(np.round(np.asarray(g.coords)[:, :2] / 1000, 2).ravel().tolist())
        elif hasattr(g, "geoms"):
            out += lines(g, min_len_km)
    return out


def step_vectors():
    import geopandas as gpd
    from pyproj import Transformer
    from shapely.geometry import box

    gl = gpd.read_file(PATHS["gl"]).to_crs(3031).geometry.union_all()
    coast = gpd.read_file(PATHS["coast"]).to_crs(3031).geometry.union_all()
    out = {}
    # whole continent: coarse
    out["gl_ant"] = rings(gl.simplify(2500), min_len_km=150)
    out["coast_ant"] = rings(coast.simplify(2500), min_len_km=150)
    # Weddell Sea sector: medium
    # (clip the outline, not the polygon, so the clip box is not drawn as part of the line)
    wb = box(-1900e3, -400e3, 0, 1400e3)
    out["gl_weddell"] = lines(gl.boundary.simplify(300).intersection(wb), min_len_km=8)
    # Henry Ice Rise: fine
    hb = box(-1120e3, 360e3, -770e3, 620e3)
    out["gl_hir"] = lines(gl.boundary.simplify(40).intersection(hb), min_len_km=1)

    to_ps = Transformer.from_crs(4326, 3031, always_xy=True)

    def ll(lon, lat):
        x, y = to_ps.transform(lon, lat)
        return [round(x / 1000, 1), round(y / 1000, 1)]

    # Labels: name, position, and the zoom (view width in km) range in which to show them
    out["labels"] = [
        {"text": "West Antarctica", "xy": [-1250, -150], "w": [2500, 6500], "kind": "region"},
        {"text": "East Antarctica", "xy": [900, 300], "w": [2500, 6500], "kind": "region"},
        {"text": "Weddell Sea", "xy": ll(-45, -72.5), "w": [1200, 9000], "kind": "sea"},
        {"text": "Ronne Ice Shelf", "xy": [-1180, 640], "w": [500, 2600], "kind": "shelf"},
        {"text": "Filchner Ice Shelf", "xy": ll(-41, -79.2), "w": [700, 2600], "kind": "shelf"},
        {"text": "Antarctic Peninsula", "xy": ll(-64, -71), "w": [2500, 6000], "kind": "region"},
        {"text": "Henry Ice Rise", "xy": [-905, 492], "w": [60, 1500], "kind": "rise"},
        {"text": "Korff Ice Rise", "xy": [-1192, 468], "w": [150, 1500], "kind": "rise"},
        {"text": "Doake Ice Rumples", "xy": [-1018, 452], "w": [60, 600], "kind": "rise"},
        {"text": "Berkner Island", "xy": ll(-48, -79.4), "w": [500, 2200], "kind": "rise"},
    ]
    out["drillsite"] = drillsite_km()

    cb = np.loadtxt(PATHS["crevasse_boundary"])
    out["crevasse_onsets"] = np.round(cb[:, :2] / 1000, 3).ravel().tolist()
    # Surface-texture contrasts that bound the crevasse-free band (green lines in Fig. 2b of the paper)
    out["texture_lines"] = []
    for side in ("East", "West"):
        tl = gpd.read_file(PATHS["texture_line"].with_name(f"HE_surf_text_line_{side}.shp")).to_crs(3031)
        out["texture_lines"].append(np.round(np.asarray(tl.geometry.iloc[0].coords)[:, :2] / 1000, 3).ravel().tolist())
    save_json("vectors.json", out)


# --------------------------------------------------------------------------------------
# Radar tracks, in the order they were driven
# --------------------------------------------------------------------------------------

HIR_BOX = (-1085, 375, -830, 595)  # km
SKIP = ("BHundelbyProcessing", "test", "Test", "trig_", "ST_testing", "Dual_band", "Single_band")


def events_times(folder):
    """First and last timestamp in a DELORES EVENTS.CSV (the raw acquisition log)."""
    f = folder / "EVENTS.CSV"
    if not f.exists():
        return None, None

    def parse(line):
        try:
            return datetime.strptime(line.split("\t")[0].strip()[:19], "%Y/%m/%d %H:%M:%S")
        except ValueError:
            return None

    with open(f, "rb") as fh:
        first = parse(fh.readline().decode(errors="ignore"))
        fh.seek(0, 2)
        size = fh.tell()
        fh.seek(max(0, size - 200_000))
        tail = fh.read().decode(errors="ignore").strip().splitlines()
    last = None
    for line in reversed(tail):
        last = parse(line)
        if last:
            break
    return first, last


def thin_track(xy, spacing_m=40.0, gap_m=400.0):
    """Drop stationary fixes, keep points at least `spacing_m` apart, split at GPS gaps."""
    xy = xy[np.isfinite(xy).all(axis=1) & (np.abs(xy).sum(axis=1) > 1e3)]
    segs, cur, last = [], [], None
    for p in xy:
        if last is None:
            cur, last = [p], p
            continue
        d = np.hypot(*(p - last))
        if d > gap_m:
            if len(cur) > 1:
                segs.append(np.array(cur))
            cur, last = [p], p
        elif d >= spacing_m:
            cur.append(p)
            last = p
    if len(cur) > 1:
        segs.append(np.array(cur))
    return segs


def step_radar():
    from pyproj import Transformer

    to_ps = Transformer.from_crs(4326, 3031, always_xy=True)
    lines = []
    for season, root in PATHS["season_dirs"].items():
        for pos in sorted(root.rglob("*positions.csv")):
            if any(s in str(pos) for s in SKIP):
                continue
            folder = pos.parent
            polar = folder / pos.name.replace("positions.csv", "positions_polar.dat")
            if polar.exists():
                xy = np.loadtxt(polar, delimiter=",", usecols=(0, 1))
            else:
                ll = np.loadtxt(pos, delimiter=",", usecols=(0, 1))
                xy = np.column_stack(to_ps.transform(ll[:, 1], ll[:, 0]))
            xy = np.atleast_2d(xy)
            inside = (
                (xy[:, 0] > HIR_BOX[0] * 1e3)
                & (xy[:, 0] < HIR_BOX[2] * 1e3)
                & (xy[:, 1] > HIR_BOX[1] * 1e3)
                & (xy[:, 1] < HIR_BOX[3] * 1e3)
            )
            if inside.sum() < 50:
                continue
            t0, t1 = events_times(folder)
            if t0 is None:
                t0 = t1 = datetime.fromtimestamp(pos.stat().st_mtime)
            segs = thin_track(xy[inside])
            if not segs:
                continue
            length = sum(np.hypot(*np.diff(s, axis=0).T).sum() for s in segs) / 1000
            lines.append(
                {
                    "name": folder.name,
                    "season": season,
                    "start": t0.isoformat(timespec="minutes"),
                    "end": (t1 or t0).isoformat(timespec="minutes"),
                    "len_km": round(length, 2),
                    "segs": [np.round(s / 1000, 3).ravel().tolist() for s in segs],
                }
            )
    # keep the two Henry Ice Rise surveys (Korff and Bungenstock traverses only clip the box)
    windows = {"2013/14": ("2014-01-02", "2014-01-12"), "2014/15": ("2014-12-23", "2015-01-02")}
    lines = [l for l in lines if windows[l["season"]][0] <= l["start"] < windows[l["season"]][1]]
    # the same file sometimes sits in two folders
    seen, unique = set(), []
    for ln in sorted(lines, key=lambda l: l["start"]):
        key = (ln["start"], round(ln["len_km"], 1))
        if key in seen:
            continue
        seen.add(key)
        unique.append(ln)
    for ln in unique:
        print(f"  {ln['season']} {ln['start']} {ln['len_km']:7.1f} km  {ln['name']}")
    print(f"  {len(unique)} lines, {sum(l['len_km'] for l in unique):.0f} km in the HIR box")
    save_json("radar_tracks.json", unique)


# --------------------------------------------------------------------------------------
# Radargrams
# --------------------------------------------------------------------------------------


def row_gain(R, smooth=31):
    """Normalise each depth sample by the median amplitude across traces (a display gain)."""
    from scipy.ndimage import uniform_filter1d

    g = np.nanmedian(np.abs(R), axis=1)
    g = uniform_filter1d(g, smooth) + 1e-6
    return R / g[:, None]


def radargram_image(A, d_km, z, d_range, z_range, width, height, clip=4.0):
    """Crop a gained radargram to a distance and elevation range and resample to an image."""
    from PIL import Image

    j = (d_km >= d_range[0]) & (d_km <= d_range[1])
    i = (z <= z_range[1]) & (z >= z_range[0])
    sub = A[np.ix_(i, j)]
    if d_km[j][0] > d_km[j][-1]:
        sub = sub[:, ::-1]
    v = np.clip((sub / clip + 1) / 2, 0, 1)
    v = np.nan_to_num(v, nan=0.5)
    img = Image.fromarray((v * 255).astype(np.uint8), "L").resize((width, height), Image.LANCZOS)
    v = np.asarray(img).astype(np.float32) / 255
    # icy colour ramp: dark navy -> pale cyan-white
    lo = np.array([0.03, 0.05, 0.09])
    mid = np.array([0.30, 0.42, 0.52])
    hi = np.array([0.93, 0.98, 1.0])
    rgb = np.where(v[..., None] < 0.5, lo + (mid - lo) * (v[..., None] / 0.5), mid + (hi - mid) * ((v[..., None] - 0.5) / 0.5))
    return rgb


def load_ridge(decimate=2):
    """HENorthAlongRidge_1, gained and on an elevation grid.

    The export is topography-corrected with the raw GPS heights, which have spikes, and has a time-zero
    offset of about 100 samples. So each trace is re-hung here: the surface echo is picked trace by trace
    and placed at a smoothed GPS surface elevation. The gain is applied by depth below the surface.
    """
    import segyio
    from scipy.ndimage import map_coordinates, median_filter, uniform_filter1d
    from scipy.spatial import cKDTree

    with segyio.open(PATHS["ridge_sgy"], ignore_geometry=True) as f:
        R = segyio.tools.collect(f.trace[:]).T.astype(np.float32)  # samples x traces
        x = f.attributes(segyio.TraceField.SourceX)[:] / 10.0
        y = f.attributes(segyio.TraceField.SourceY)[:] / 10.0
    d = np.insert(np.cumsum(np.hypot(np.diff(x), np.diff(y))), 0, 0) / 1000
    pos = np.loadtxt(PATHS["ridge_pos"], delimiter=",")
    _, k = cKDTree(pos[:, :2]).query(np.column_stack([x, y]))
    h = median_filter(pos[k, 2], 801, mode="nearest")
    h = uniform_filter1d(h, 401, mode="nearest")
    # surface echo: first sample after the start of the record that exceeds 40% of the trace maximum
    seg = np.abs(R[40:450])
    s = 40 + np.argmax(seg > 0.4 * seg.max(axis=0), axis=0)
    s = median_filter(s.astype(float), 301, mode="nearest")
    # depth-referenced, smoothed along the line and decimated
    R = uniform_filter1d(R, decimate, axis=1)[:, ::decimate]
    s, h, x, y, d = s[::decimate], h[::decimate], x[::decimate], y[::decimate], d[::decimate]
    nd = int(R.shape[0] - s.max() - 1)
    cols = np.broadcast_to(np.arange(R.shape[1]), (nd, R.shape[1]))
    F = map_coordinates(R, [s[None, :] + np.arange(nd)[:, None], cols], order=1)
    g = uniform_filter1d(np.median(np.abs(F), axis=1), 31) + 1e-6
    F /= g[:, None]
    z = np.arange(np.ceil(h.max()), np.floor(h.min() - nd * SAMPLE_TO_DIST), -1.0)
    A = map_coordinates(F, [(h[None, :] - z[:, None]) / SAMPLE_TO_DIST, np.broadcast_to(np.arange(F.shape[1]), (len(z), F.shape[1]))], order=1, cval=np.nan)
    return A, x, y, h, d, z


def load_fl5():
    data = np.loadtxt(PATHS["fl5_radargram"])
    p = np.loadtxt(PATHS["fl5_pos"])
    x, y, h = p[:, 2], p[:, 3], p[:, 6]
    d = np.insert(np.cumsum(np.hypot(np.diff(x), np.diff(y))), 0, 0) / 1000
    z = h.max() - SAMPLE_TO_DIST * np.arange(data.shape[0])
    # Measure distance the way the notebook plots it, so the drill site is at 9.1 km.
    drill = np.array(drillsite_km()) * 1000
    k = np.argmin(np.hypot(x - drill[0], y - drill[1]))
    if abs(d[k] - 9.1) > abs((d[-1] - d[k]) - 9.1):
        d = d[-1] - d
    return data, x, y, h, d, z, k


def line_meta(x, y, h, d, every_m=50):
    """Positions along a radar line, for drawing it on the map and syncing the reveal."""
    order = np.argsort(d)
    x, y, h, d = x[order], y[order], h[order], d[order]
    keep = np.unique(np.searchsorted(d, np.arange(d[0], d[-1], every_m / 1000)))
    return {
        "d": np.round(d[keep], 3).tolist(),
        "xy": np.round(np.column_stack([x[keep], y[keep]]) / 1000, 3).ravel().tolist(),
        "surface": np.round(h[keep], 1).tolist(),
    }


def step_radargrams():
    meta = {}
    print("HEnorth along the ridge (9 Jan 2014)")
    A, x, y, h, d, z = load_ridge()
    full = dict(d=[0, round(float(d[-1]), 3)], z=[-640, 200])
    save_webp("rg_ridge.webp", radargram_image(A, d, z, full["d"], full["z"], 2400, 760, clip=3.5), quality=85)
    zoom = dict(d=[31.2, round(float(d[-1]), 3)], z=[-520, -230])
    save_webp("rg_ridge_zoom.webp", radargram_image(A, d, z, zoom["d"], zoom["z"], 2000, 760, clip=3.5), quality=85)
    meta["ridge"] = {
        "name": "HEnorth along the ridge",
        "date": "2014-01-09",
        "full": {"src": "assets/rg_ridge.webp", **full},
        "zoom": {"src": "assets/rg_ridge_zoom.webp", **zoom},
        "line": line_meta(x, y, h, d),
        "migrated": False,
    }

    print("HEnorth FL5 (2014/15)")
    R, x, y, h, d, z, k = load_fl5()
    A = row_gain(R)
    full = dict(d=[0.25, 12.2], z=[-480, 170])
    save_webp("rg_fl5.webp", radargram_image(A, d, z, full["d"], full["z"], 2400, 900), quality=85)
    zoom = dict(d=[7.1, 11.1], z=[-450, -250])
    save_webp("rg_fl5_zoom.webp", radargram_image(A, d, z, zoom["d"], zoom["z"], 2000, 760), quality=85)
    # block-diagram face for the 3-D view: 3 km either side of the drill site, surface to below the bed
    face = dict(d=[6.1, 12.1], z=[-470, 170])
    rgb = radargram_image(A, d, z, face["d"], face["z"], 2048, 1024)
    # transparent above the ice surface
    order = np.argsort(d)
    dd = np.linspace(*face["d"], rgb.shape[1])
    surf = np.interp(dd, d[order], h[order])
    zz = np.linspace(face["z"][1], face["z"][0], rgb.shape[0])
    alpha = (zz[:, None] <= surf[None, :] + 2).astype(np.float32)
    save_webp("rg_fl5_face.webp", np.dstack([rgb, alpha]), quality=85)
    # bed at the drill site: the strongest echo between 380 and 460 m below sea level
    near = np.abs(d - d[k]) < 0.05
    rows = (z > -460) & (z < -380)
    bed_z = float(z[rows][np.argmax(np.abs(R[np.ix_(rows, near)]).mean(axis=1))])
    print(f"  bed at the drill site: {bed_z:.0f} m, surface {h[k]:.0f} m, ice {h[k] - bed_z:.0f} m thick")
    meta["fl5"] = {
        "name": "HEnorth FL5",
        "drill_bed_z": round(bed_z, 1),
        "date": "2014-12",
        "full": {"src": "assets/rg_fl5.webp", **full},
        "zoom": {"src": "assets/rg_fl5_zoom.webp", **zoom},
        "face": {"src": "assets/rg_fl5_face.webp", **face},
        "drill_d": round(float(d[k]), 3),
        "line": line_meta(x, y, h, d),
        "migrated": True,
    }
    save_json("radargrams.json", meta)


# --------------------------------------------------------------------------------------
# 3-D block: WorldView strip along FL5 for the top face
# --------------------------------------------------------------------------------------


def step_block():
    import rasterio
    from rasterio.windows import from_bounds
    from scipy.ndimage import map_coordinates

    rg = json.loads((OUT / "radargrams.json").read_text())["fl5"]
    d = np.array(rg["line"]["d"])
    xy = np.array(rg["line"]["xy"]).reshape(-1, 2)
    face = rg["face"]
    # straight-line frame fitted to the line inside the face's distance range
    sel = (d >= face["d"][0]) & (d <= face["d"][1])
    p0, p1 = xy[sel][0], xy[sel][-1]
    u = (p1 - p0) / np.hypot(*(p1 - p0))
    v = np.array([-u[1], u[0]])
    depth_km = 2.0  # how far the block extends behind the radar line
    res = 0.004  # km per pixel
    nu = int(round((face["d"][1] - face["d"][0]) / res))
    nv = int(round(depth_km / res))
    uu, vv = np.meshgrid(np.linspace(0, np.hypot(*(p1 - p0)), nu), np.linspace(0, depth_km, nv))
    X = (p0[0] + uu * u[0] + vv * v[0]) * 1000
    Y = (p0[1] + uu * u[1] + vv * v[1]) * 1000
    with rasterio.open(PATHS["worldview"]) as src:
        b = (X.min() - 50, Y.min() - 50, X.max() + 50, Y.max() + 50)
        win = from_bounds(*b, src.transform).round_offsets().round_lengths()
        step = 4  # the scene is 0.5 m; read at 2 m
        img = src.read(1, window=win, out_shape=(int(win.height // step), int(win.width // step))).astype(np.float32)
        t = src.window_transform(win) * rasterio.Affine.scale(step)
    col, row = ~t * (X, Y)
    val = map_coordinates(img, [row, col], order=1, cval=0)
    valid = val > 0
    lo, hi = np.percentile(val[valid], [0.5, 99.5])
    lum = 0.25 + 0.6 * np.clip((val - lo) / (hi - lo), 0, 1)
    rgb = grade(lum, None, 40, 0.5)
    rgb[~valid] = GRADE_LIGHT * 0.7
    save_webp("block_top.webp", rgb[::-1], quality=82)  # row 0 at the back edge
    save_json(
        "block.json",
        {
            "p0": np.round(p0, 3).tolist(),
            "u": np.round(u, 5).tolist(),
            "depth_km": depth_km,
            "top": "assets/block_top.webp",
        },
    )


# --------------------------------------------------------------------------------------
# Temperature profiles after grounding (vertical-temperature-after-grounding.ipynb)
# --------------------------------------------------------------------------------------


def step_temperature():
    import xarray as xr

    ds = xr.open_dataset(PATHS["grounding_sensitivity"])
    T = ds["T"]
    ts = float(ds.attrs["T_surface"])
    out = {
        "depth": [0.0] + [float(v) for v in ds.depth.values],
        "age": [float(v) for v in ds.age.values],
        "T": [[ts] + [round(float(v), 3) for v in T.sel(age=a).values] for a in ds.age.values],
        "H": float(ds.attrs["H"]),
        "note": "1-D model with placeholder site values (500 m of ice, -27 C surface)",
    }
    save_json("temperature.json", out)


# --------------------------------------------------------------------------------------
# PISM simulation (Kingslake et al. 2018; Albrecht 2018, doi:10.5880/PIK.2018.008)
# --------------------------------------------------------------------------------------


def step_pism():
    from pism_extract import extract  # kept separate: depends on the layout of the PISM files

    extract(PATHS["pism_dir"], OUT, PATHS["gl"])


# --------------------------------------------------------------------------------------


def update_manifest(**kw):
    path = OUT / "manifest.json"
    man = json.loads(path.read_text()) if path.exists() else {}
    man.update(kw)
    path.write_text(json.dumps(man, indent=1))


STEPS = {
    "basemaps": step_basemaps,
    "vectors": step_vectors,
    "radar": step_radar,
    "radargrams": step_radargrams,
    "block": step_block,
    "temperature": step_temperature,
    "pism": step_pism,
}

if __name__ == "__main__":
    args = sys.argv[1:]
    for a in [a for a in args if "=" in a]:
        k, v = a.split("=", 1)
        PATHS[f"{k}_dir"] = Path(v)
    names = [a for a in args if "=" not in a] or list(STEPS)
    for name in names:
        print(f"== {name}")
        STEPS[name]()
