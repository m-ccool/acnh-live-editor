(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function buildOptionGroup(label, tracks) {
    if (!tracks.length) {
      return null;
    }

    return h(
      'optgroup',
      {
        key: label,
        label
      },
      ...tracks.map((track) => h('option', {
        key: track.id,
        value: track.id
      }, track.title))
    );
  }

  function MusicLibraryOptions(props) {
    const tracks = Array.isArray(props.tracks) ? props.tracks : [];
    const themeTracks = tracks.filter((track) => track.group === 'Theme defaults');
    const kkTracks = tracks.filter((track) => track.group === 'K.K. Airchecks');
    const remainingTracks = tracks.filter((track) => {
      return track.group !== 'Theme defaults' && track.group !== 'K.K. Airchecks';
    });

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      buildOptionGroup('Theme defaults', themeTracks),
      buildOptionGroup('K.K. Airchecks', kkTracks),
      buildOptionGroup('Library', remainingTracks)
    );
  }

  registerComponent('MusicLibraryOptions', MusicLibraryOptions);
})();
