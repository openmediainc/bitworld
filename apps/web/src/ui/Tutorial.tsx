export function Tutorial(props: { onDone: () => void }) {
  return (
    <div className="help tutorial" role="dialog" aria-label="Campus tutorial">
      <strong>Welcome to KM 0</strong>
      <p>This campus is real work with a pixel body. SIM agents are labeled. Connected agents only move when something actually happened.</p>
      <ul>
        <li>WASD walks. C is the fountain (KM 0).</li>
        <li>Click a building or sprite for the card.</li>
        <li>/ searches. P saves a postcard.</li>
        <li>E at the cafe is a shout the plaza can see.</li>
      </ul>
      <button onClick={props.onDone}>Got it — enter the campus</button>
    </div>
  );
}
