(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function InventoryGrid(props) {
    const slots = Array.isArray(props.slots) ? props.slots : [];
    const selectedSlotIndex = Number(props.selectedSlotIndex || 0);
    const clipboardSourceSlotIndex = Number(props.clipboardSourceSlotIndex ?? -1);
    const clipboardMode = props.clipboardMode === 'copy' || props.clipboardMode === 'move'
      ? props.clipboardMode
      : null;
    const clipboardBadgeIndex = Number(props.clipboardBadgeIndex ?? -1);
    const pendingSlot = Number(props.pendingSlot || 0);
    const overwriteGuard = props.overwriteGuard || null;
    const activeFilter = String(props.activeFilter || 'all');
    const normalizeCategory = typeof props.normalizeCategory === 'function'
      ? props.normalizeCategory
      : (value) => String(value || '').trim().toLowerCase();

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...slots.map((slot, index) => {
        const classNames = ['inventory-slot'];
        const style = {};

        if (index === selectedSlotIndex) {
          classNames.push('is-selected');
        }

        if (index === clipboardSourceSlotIndex) {
          classNames.push('is-clipboard-source');
        }

        if (clipboardMode && index === clipboardBadgeIndex) {
          classNames.push(clipboardMode === 'copy' ? 'is-clipboard-copy' : 'is-clipboard-move');
        }

        if (overwriteGuard && overwriteGuard.slotIndex === index) {
          classNames.push(`is-paste-armed-${overwriteGuard.step}`);
        }

        if (slot.slot === pendingSlot) {
          classNames.push('is-pending-write');
        }

        if (
          slot.item &&
          activeFilter !== 'all' &&
          normalizeCategory(slot.item.category) !== normalizeCategory(activeFilter)
        ) {
          style.opacity = '0.3';
        }

        const children = [
          h('span', { className: 'slot-index', key: `slot-index-${slot.slot}` }, String(slot.slot))
        ];

        if (slot.item) {
          const imageSrc = window.resolveAppUrl
            ? window.resolveAppUrl(slot.item.icon_url || slot.item.image_url || '')
            : (slot.item.icon_url || slot.item.image_url || '');
          children.push(
            h('img', {
              key: `slot-image-${slot.slot}`,
              src: imageSrc,
              alt: slot.item.name,
              onError(event) {
                event.currentTarget.style.display = 'none';
              }
            })
          );

          if (!imageSrc) {
            children.push(
              h(
                'span',
                { className: 'inventory-slot-fallback-label', key: `slot-label-${slot.slot}` },
                /^0x/i.test(String(slot.item.name || '')) ? 'HEX' : 'ITEM'
              )
            );
          }

          if (slot.count > 1) {
            children.push(
              h('span', { className: 'inventory-slot-stack-count', key: `slot-count-${slot.slot}`, 'aria-hidden': 'true' }, String(slot.count))
            );
          }
        }

        if (slot.slot === pendingSlot) {
          children.push(
            h(
              'span',
              { className: 'inventory-slot-pending-indicator', key: `slot-pending-${slot.slot}`, 'aria-hidden': 'true' },
              h('span', { className: 'inventory-slot-pending-ring' })
            )
          );
        }

        return h(
          'button',
          {
            key: `slot-${slot.slot}`,
            type: 'button',
            className: classNames.join(' '),
            style,
            title: slot.item ? String(slot.item.name || slot.itemId || `Slot ${slot.slot}`) : `Slot ${slot.slot}`,
            onClick() {
              props.onSelectSlot(index);
            },
            onDoubleClick() {
              props.onDoubleClick(index);
            },
            onPointerDown(event) {
              props.onPointerDown(index, event);
            },
            onPointerMove(event) {
              props.onPointerMove(index, event);
            },
            onPointerUp(event) {
              props.onPointerUp(index, event);
            },
            onPointerCancel(event) {
              props.onPointerCancel(index, event);
            },
            draggable: !!slot.item,
            onDragStart(event) {
              props.onDragStart(index, event);
            },
            onDragOver(event) {
              props.onDragOver(index, event);
            },
            onDrop(event) {
              props.onDrop(index, event);
            },
            onDragEnd(event) {
              props.onDragEnd(index, event);
            }
          },
          ...children
        );
      })
    );
  }

  registerComponent('InventoryGrid', InventoryGrid);
})();
