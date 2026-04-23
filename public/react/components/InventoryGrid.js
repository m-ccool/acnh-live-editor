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
          const imageSrc = slot.item.icon_url || slot.item.image_url || '';
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
