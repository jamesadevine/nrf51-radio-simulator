import * as net from "net";

const LINK_PORT = 8127;

enum PacketType
{
    CommandPacket,
    StandardPacket,
    LinkPacket
}

class LinkPacket
{
    clientId: number;
    timestamp: number;
    type: PacketType;
    payload: string;
    crc: boolean;

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

        this.timestamp;

        this.crc = true;
    }
}

class LinkClient
{
    port: number;
    s:net.Socket;
    clientId: number;
    cb:(packet: any, type: PacketType) =>void

    constructor(port:number)
    {
        this.clientId = -1;
        this.port= port;
        this.s = net.createConnection(port);
        this.s.setEncoding("utf8");

        this.s.on("data",this.handleData)

        this.cb = null;
    }

    send(data:any, type: PacketType = PacketType.StandardPacket)
    {
        this.s.write(JSON.stringify(new LinkPacket(this.clientId, data, type)));
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
            this.cb(JSON.parse(packet.payload),packet.type);
    }

    setRxCallback(cb:(packet: any, type: PacketType) => void)
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
    cachedPackets: LinkPacket[];
    count: number;

    constructor(port: number)
    {
        this.s = new net.Server();
        this.port = port;
        this.connections = [];
        this.connId = 1;
        this.cachedPackets = [];

        this.count = 0;

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
        let dp : LinkPacket = data as LinkPacket;

        var exists = false;
        for (let p of this.cachedPackets)
        {
            if (p.payload != dp.payload)
            {
                exists = true;
                break;
            }
        }

        if (!exists)
        {
            console.log("DOESN'T EXIST ",this.cachedPackets, this.count);
            setTimeout(this.forwardPacket, 50, dp, this.count++);
        }

        this.cachedPackets.push(dp);
    }

    private forwardPacket = (dp: LinkPacket, count:number) =>
    {
        // compute if "crc" valid
        for (let p of this.cachedPackets)
        {
            if (p.payload == dp.payload && dp.timestamp - p.timestamp > 2)
            {
                dp.crc = false;
                break;
            }
        }

        console.log("sending ",dp, "count", count);

        for(let c of this.connections)
        {
            c.write(dp);
        }

        // console.log("BEFORE ", this.cachedPackets);
        for (let i = 0; i < this.cachedPackets.length; i++)
        {
            if (this.cachedPackets[i].payload == dp.payload)
            {
                this.cachedPackets = this.cachedPackets.splice(i,1);
            }
        }
        // console.log("AFTER ", this.cachedPackets);
    }

    private handleDisconnect = () =>
    {
        console.log("resetting connections")

        for(let c of this.connections)
        {
            c.destroy()
        }

        this.connections = [];
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

export {Link, LinkClient, LinkPacket, PacketType, LINK_PORT};