function displayDate() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  document.getElementById("homebutton").innerHTML = `${month}/${day}`;
}
