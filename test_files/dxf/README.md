# DXF Test Files for Ground Plane Configurator

## ✅ Valid Files (≥25mm minimum)

### Basic Shapes
- **test_square_80mm.dxf** - Square 80×80mm
- **test_rect_with_hole.dxf** - Rectangle 100×80mm  
- **test_circle_80mm.dxf** - Circle 80mm diameter
- **test_triangle.dxf** - Triangle 80×60mm

### Regular Polygons
- **test_hexagon_80mm.dxf** - Regular hexagon 80mm diameter
- **test_hexagon_60mm.dxf** - Irregular hexagon 80×60mm
- **test_octagon_80mm.dxf** - Regular octagon 80mm diameter

### Complex Shapes (Concave)
- **test_l_shape_80mm.dxf** - L-shape 80×80mm
- **test_plus_wide_100mm.dxf** - Plus/cross shape 100×100mm with 40mm wide arms (solid center)

## ❌ Invalid Files (Will be rejected)

- **invalid_empty.dxf** - No geometry (empty file)
- **invalid_too_small_15mm.dxf** - 15×15mm (too small)
- **invalid_too_small_24mm.dxf** - 24×24mm (below minimum)
- **test_plus_80mm.dxf** - Plus shape 80×60mm with 20mm arms (arms too narrow - cannot fit 25mm antenna)

## Expected Behavior

### Valid Files ✅
- Import successfully
- Display blue edges with light blue fill
- Antenna (25×25mm) constrained inside shape
- Smooth dragging with boundary detection

### Invalid Files ❌
- Reject with error message
- Explain minimum size requirement (25×25mm)
- Do not proceed to positioning step

## Testing Checklist

1. **Basic**: test_square_80mm.dxf
2. **Circular**: test_circle_80mm.dxf
3. **Polygon**: test_hexagon_80mm.dxf
4. **Concave**: test_l_shape_80mm.dxf, test_plus_wide_100mm.dxf
5. **Validation**: Upload invalid files to test error handling

## Important Notes

⚠️ **Plus/Cross Shapes**: Must have a solid center area large enough for the antenna. A hollow plus shape (where arms don't overlap enough at center) will be rejected even if the overall dimensions are large enough.

Example:
- ❌ test_plus_80mm.dxf - 20mm wide arms create only 20×20mm center (too small)
- ✅ test_plus_wide_100mm.dxf - 40mm wide arms create 40×40mm solid center (fits antenna)
