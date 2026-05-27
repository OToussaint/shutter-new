# Roller Shutter Controller 🪟

A compact and intuitive Home Assistant Lovelace card for controlling roller shutters, blinds, and garage doors.

## Features

- **Compact Design**: Ultra-small 100×100px card that fits anywhere
- **Visual Feedback**: See your shutter position at a glance with a graphical representation
- **Multiple Control Methods**:
  - Drag the handle up/down to set any position
  - One-click buttons for fully open, close, or stop
  - Quick-access favorite position button
- **Touch & Mouse Friendly**: Works smoothly with both desktop and mobile devices
- **Real-Time Updates**: Instantly reflects changes from other apps or automations
- **Motion Indicators**: Shows when shutters are opening/closing
- **Customizable**: Hide controls you don't need

## Installation

### 1. Copy the file to your Home Assistant

Copy `shutter-new.js` to your Home Assistant config folder:
```
.homeassistant/www/shutter-new.js
```

### 2. Add to your dashboard

In your Lovelace dashboard (edit mode), add a new card and search for **"Roller Shutter Controller"** in the custom cards list, or use YAML:

```yaml
type: custom:shutter-new
entity: cover.living_room_blinds
```

## Configuration

### Required
- **entity**: The cover entity to control (e.g., `cover.living_room_blinds`, `cover.garage_door`)

### Optional
- **name**: Custom display name (defaults to entity's friendly name)
- **favorite**: Position to jump to when clicking the heart button (0-100%, default: 50%)
- **hide**: Array of controls to hide from the card

### Examples

#### Basic setup
```yaml
type: custom:shutter-new
entity: cover.bedroom_blinds
```

#### With custom name and favorite position
```yaml
type: custom:shutter-new
entity: cover.living_room_shutters
name: Living Room
favorite: 75
```

#### Hide controls you don't use
```yaml
type: custom:shutter-new
entity: cover.kitchen_door
favorite: 30
hide:
  - stop    # Hide the stop button
  - favorite  # Hide the favorite button
```

## How to Use

### Visual Display
- The vertical bar shows your shutter position
- Empty area = shutter is closed
- Filled area = shutter is open
- Arrows appear when shutters are moving

### Controls

| Control | What It Does |
|---------|------------|
| **↑ Open** | Opens the shutter fully |
| **⏹ Stop** | Stops the shutter immediately |
| **↓ Close** | Closes the shutter fully |
| **❤ Favorite** | Moves to your favorite position |
| **Drag** | Click and drag the bar to any position |

### Dragging to Set Position

1. Click and hold on the gray handle (the small bar in the middle)
2. Drag up to open more, down to close more
3. A number shows your current position while dragging
4. Release to apply the position

## Supported Entities

This card works with any Home Assistant entity that supports cover commands, including:
- Roller shutters & blinds
- Garage doors
- Sliding glass doors
- Motorized awnings
- Any other cover device

## Troubleshooting

### Card shows "Entity not found"
- Make sure the entity ID is correct
- Check that your cover entity is properly configured in Home Assistant
- Reload the page or clear browser cache

### Changes aren't taking effect
- Some devices have a delay in responding
- Try refreshing your dashboard
- Check Home Assistant's developer tools to see the entity state

### Buttons are grayed out
- Up button grays out when shutter is fully open
- Down button grays out when shutter is fully closed
- This is normal and prevents unnecessary commands

## Tips & Tricks

- **Multiple shutters**: Add the card multiple times for different shutters in the same room
- **Automation friendly**: Use Home Assistant automations to trigger shutter movements
- **Mobile friendly**: The large drag area makes it easy to use on phones
- **Customize appearance**: Adjust your Home Assistant theme to match the card style

## Support

If you encounter issues:
1. Check that your cover entity is working in Home Assistant
2. Try removing and re-adding the card
3. Clear your browser cache
4. Check browser console for error messages (F12)

## License

MIT
