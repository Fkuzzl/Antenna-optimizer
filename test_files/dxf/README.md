# DXF Test Files for Ground Plane Configurator

This directory contains DXF test files for validating the ground plane import functionality. All files use AutoCAD R2000 DXF format.

## Validation Requirements

- **Minimum dimensions**: 25mm × 25mm (to accommodate antenna element)
- **Supported entities**: POLYLINE, LWPOLYLINE, LINE, CIRCLE, ARC
- **Coordinate system**: Origin at (0,0)

## ✅ Valid Test Files

### Basic Shapes
- **test_square_80mm.dxf** - Square 80×80mm
- **test_circle_80mm.dxf** - Circle ⌀80mm
- **test_triangle.dxf** - Triangle 80×60mm

### Polygons
- **test_hexagon_80mm.dxf** - Regular hexagon ⌀80mm
- **test_hexagon_60mm.dxf** - Irregular hexagon 80×60mm
- **test_octagon_80mm.dxf** - Regular octagon ⌀80mm

### Complex Shapes
- **test_l_shape_80mm.dxf** - L-shape 80×80mm (concave)
- **test_plus_wide_100mm.dxf** - Plus shape 100×100mm, 40mm arms
- **test_rect_with_hole.dxf** - Rectangle 100×80mm with cutout

## ❌ Invalid Test Files

- **invalid_empty.dxf** - No geometry
- **invalid_too_small_15mm.dxf** - 15×15mm (below minimum)
- **invalid_too_small_24mm.dxf** - 24×24mm (below minimum)
- **test_plus_80mm.dxf** - Plus shape with 20mm arms (insufficient center clearance)

## Usage

**Import valid file:**
```javascript
// Expected: Success with blue edges + light blue fill
// Antenna (25×25mm) constrained within boundaries
```

**Import invalid file:**
```javascript
// Expected: Rejection with error message
// Explains minimum size requirement
```

## Testing Checklist

- [ ] Basic shape: `test_square_80mm.dxf`
- [ ] Circular: `test_circle_80mm.dxf`
- [ ] Polygon: `test_hexagon_80mm.dxf`
- [ ] Concave: `test_l_shape_80mm.dxf`
- [ ] Complex: `test_plus_wide_100mm.dxf`
- [ ] Validation: All `invalid_*.dxf` files reject correctly

## Notes

⚠️ **Cross/Plus shapes** require sufficient center area. Arms must overlap to create ≥25×25mm solid region at center for antenna placement.
