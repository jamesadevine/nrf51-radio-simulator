import * as net from "net";

const LINK_PORT = 8127;

enum PacketType
{
    CommandPacket,
    StandardPacket
}

class LinkPacket
{
    clientId: number;
    timestamp: number;
    type: PacketType;
    payload: string;

    constructor(clientId:number, payload:string, type:PacketType);
    constructor(clientId:number, payload:Object, type:PacketType);
    constructor(clientId:number, payload:any, type:PacketType)
    {
        var date = new Date();

        this.timestamp = date.getTime();
        this.clientId = clientId;
        this.type = type;

        if (typeof payload == "object")
            this.payload = JSON.stringify(payload);
        else
            this.payload = payload;

        this.timestamp
    }
}

class LinkClient
{
    port: number;
    s:net.Socket;
    clientId: number;
    cb:(packet: any) =>void

    constructor(port:number)
    {
        this.clientId = -1;
        this.port= port;
        this.s = net.createConnection(port);
        this.s.setEncoding("utf8");

        this.s.on("data",this.handleData)

        this.cb = null;
    }

    send(data:any)
    {
        this.s.write(JSON.stringify(new LinkPacket(this.clientId,data,PacketType.StandardPacket)));
    }

    handleData = (data: any) =>
    {
        var packet: LinkPacket = JSON.parse(data);

        if(packet.clientId == this.clientId)
            return;

        if (packet.type == PacketType.CommandPacket)
        {
            this.clientId = packet.clientId;
            return;
        }

        if (this.cb != null)
            this.cb(JSON.parse(packet.payload));
    }

    setRxCallback(cb:(packet: any) => void)
    {
        this.cb = cb;
    }
}

class Link
{
    s: net.Server;
    port: number;
    connId:number;
    connections: net.Socket[]

    constructor(port: number)
    {
        this.s = new net.Server();
        this.port = port;
        this.connections = [];
        this.connId = 1;

        this.s.listen(port);
        this.s.on("data",this.handleData)
        this.s.on("error", this.onError);

        this.s.on("connection", this.handleConnect);
    }
    private handleConnect = (conn: net.Socket) =>
    {
        this.connections.push(conn);
        conn.setEncoding("utf8");
        conn.write(JSON.stringify(new LinkPacket(this.connId, "", PacketType.CommandPacket)));
        this.connId++;
        conn.on("close", this.handleDisconnect);
        conn.on("data",this.handleData);
    }

    private handleData = (data:any) =>
    {
        console.log("Link Server: ", data);
        for(let c of this.connections)
        {
            c.write(data);
        }
    }

    private handleDisconnect = ()=>
    {
        console.log("something closed")
    }

    private onError(err: any)
    {
        console.log(err);
    }

    getConnection() : LinkClient
    {
        return new LinkClient(this.port);
    }

}

export {Link, LinkClient, LinkPacket, LINK_PORT};