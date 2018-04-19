import {Radio} from "./Radio"
import {PeridoRadio} from "./PeridoRadio"

let r = new Radio();
let pr = new PeridoRadio(r, 0x123456, 0x789123);
let str = "abc123";

pr.enable();
pr.send("ABC123");

setInterval(()=>{
    pr.send("ABC123");
}, 20000)