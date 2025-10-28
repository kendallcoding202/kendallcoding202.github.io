const line = document.getElementById("bouncingLine");

let x = Math.random() * (window.innerWidth - 100);
let y = Math.random() * (window.innerHeight - 3);
let dx = (Math.random() - 0.5) * 5;
let dy = (Math.random() - 0.5) * 5;

function animate() {
  x += dx;
  y += dy;

  if (x <= 0 || x >= window.innerWidth - 100) {
    dx = -dx;
  }
  if (y <= 0 || y >= window.innerHeight - 3) {
    dy = -dy;
  }

  line.style.left = x + "px";
  line.style.top = y + "px";

  requestAnimationFrame(animate);
}

animate();
