// document.getElementById("phone1").addEventListener("click", function () {
//Change the displayed image source
//  this.src = "contactimg/phoneRinging.png";
//});

const img = document.getElementById("phone1");
const toggleImage = () => {
  img.src = img.src.includes("phoneRinging")
    ? "contactimg/phone.png"
    : "contactimg/phoneRinging.png";
};

toggleImage();
