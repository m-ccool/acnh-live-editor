(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function InventoryGrid(props) {
    const slots = Array.isArray(props.slots) ? props.slots : [];
    const selectedSlotIndex = Number(props.selectedSlotIndex || 0);
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

        if (overwriteGuard && overwriteGuard.slotIndex === index) {
          classNames.push(`is-paste-armed-${overwriteGuard.step}`);
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
          children.push(
            h('img', {
              key: `slot-image-${slot.slot}`,
              src: slot.item.icon_url || slot.item.image_url || '',
              alt: slot.item.name,
              onError(event) {
                event.currentTarget.style.display = 'none';
              }
            })
          );
        }

        return h(
          'button',
          {
            key: `slot-${slot.slot}`,
            type: 'button',
            className: classNames.join(' '),
            style,
            onClick() {
              props.onSelectSlot(index);
            },
            onDoubleClick() {
              props.onDoubleClick(index);
            },
            onPointerUp(event) {
              props.onPointerUp(index, event);
            }
          },
          ...children
        );
      })
    );
  }

  registerComponent('InventoryGrid', InventoryGrid);
})();
