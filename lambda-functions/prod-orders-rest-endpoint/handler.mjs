import crypto from "crypto";

const defaultHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Credentials": "true"
};

const handlers = {

    "/orders": {

        "OPTIONS": function () {
            return {
                body: "",
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
                    "Access-Control-Allow-Credentials": "true",
                    "Allow": "OPTIONS, GET, POST"
                }
            };
        },

        "GET": async function(event, db) {
            let headers = defaultHeaders;
            let id_token_str = event.headers.authorization.split(" ")[1];
            let id_token = JSON.parse(Buffer.from(id_token_str.split('.')[1], 'base64').toString());
            if (!id_token || !id_token.sub || !id_token.email_verified) {
                return {statusCode: 403, body: "", headers};
            }
            let body = await db.getAllOrdersForUser(id_token.sub);
            return {statusCode: 200, body:JSON.stringify(body), headers};
        },

        "POST": async function(event, db) {
            let id_token_str = event.headers.authorization.split(" ")[1];
            let id_token = JSON.parse(Buffer.from(id_token_str.split('.')[1], 'base64').toString());
            if (!id_token || !id_token.sub || !id_token.email_verified) {
                return {statusCode: 403, body: "", headers: defaultHeaders};
            }

            let orderRequest = JSON.parse(event.body);
            let order = {};
            order.OrderId = crypto.randomUUID();
            order.user_id = id_token.sub;
            order.timestamp = Date.now();

            {
                if (!orderRequest.shippingAddress) {
                    return {statusCode: 400, body: "", headers: defaultHeaders};
                }
                let {firstName,lastName,mailingAddress1,city,zip} = orderRequest.shippingAddress;
                if (!firstName || !lastName || !mailingAddress1 || !city || !zip) {
                    return {statusCode: 400, body: "", headers: defaultHeaders};
                }
            }
            {
                if (!orderRequest.billingAddress) {
                    return {statusCode: 400, body: "", headers: defaultHeaders};
                }
                let {firstName,lastName,mailingAddress1,city,zip} = orderRequest.billingAddress;
                if (!firstName || !lastName || !mailingAddress1 || !city || !zip) {
                    return {statusCode: 400, body: "", headers: defaultHeaders};
                }
            }

            if (!orderRequest.items || orderRequest.items.length == 0) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }
            let promises = [];
            for (let PLU of orderRequest.items) {
                promises.push(new Promise(async (res,rej) => {
                    try {
                        let item = await db.getProductByPLU(PLU);
                        res({"PLU": item.PLU, "price": item.price});
                    } catch (err) {
                        rej(err);
                    }
                }))
            }
            order.items = [];
            try {
                order.items = await Promise.all(promises)
            } catch (e) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }

            // Basic card validation - these are the minimum requirements for a 
            // a card to possibly be valid, but does not fully verify that 
            // the card is valid
            let paymentInfo = orderRequest.paymentInfo;
            if (!paymentInfo) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }
            let PAN = paymentInfo.cardNumber;
            let cvc = paymentInfo.securityCode;
            let nameOnCard = paymentInfo.nameOnCard;
            let expiration = paymentInfo.expiration;
            if (!PAN || !cvc || !nameOnCard || !expiration) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }

            if (PAN.length < 8 || PAN.length > 19) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }
            let luhnSum = PAN.split("")
                .reverse()
                .map(s => parseInt(s))
                .map((x,i) => i%2 == 0 ? x : x*2)
                .reduce((sum,x) => sum+x, 0);
            if (luhnSum % 10 != 0) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }

            let matches = 
                expiration.match("^(\\d{2})/(\\d{2})$") ||
                expiration.match("^(\\d{2})/(\\d{4})$");
            if (!matches) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }
            let [_,month,year] = matches;
            // Did not use,
            // > `new Date(year, monthIndex)`
            // Because it considers year 20 to be 1920
            if (new Date(`${month}/01/${year}`) < new Date()) {
                return {statusCode: 400, body: "", headers: defaultHeaders};
            }
            
            // This is were the card information would be verified and the
            // payment process would be started with some payment api like stripe
            
            order.paymentInfo = {};
            // Only save the last four digits of the PAN to meet PCI Data Security Standard
            order.paymentInfo.cardNumber = PAN.substring(PAN.length - 4);

            //console.log(orderRequest);
            order.shippingAddress = orderRequest.shippingAddress;
            order.billingAddress = orderRequest.billingAddress;
            
            await db.insertOrder(order);

            return {
                statusCode: 200, 
                body: JSON.stringify({"OrderId": order.OrderId}),
                headers: defaultHeaders
            };
        }
    },
    "/orders/{OrderId+}": {}
};

export const createHandler = function(db) {
return async (event, context) => {

    return handlers[event.resource][event.httpMethod](event,db);

    /*
    let body;
    let statusCode = 200;
    try {
        switch (event.resource) {
        case "/orders":
            switch (event.httpMethod) {
            case "OPTIONS":
            
            case "GET": {
            }
            
            case "POST": {
            }
            
            default:
                throw new Error(`Unsupported route: "${event.httpMethod} ${event.resource}"`);
            }
            break;
            
        case "/orders/{OrderId+}":
            switch(event.httpMethod) {
            case "OPTIONS":
                body = "";
                headers["Allow"] = "OPTIONS, GET, POST";
                break;
                
            case "GET":
                body = await db.getOrderById(event.pathParameters.OrderId);
                break;
                
            default:
                throw new Error(`Unsupported route: "${event.httpMethod} ${event.resource}"`);
            }
            break;
                
        default:
            throw new Error(`Unsupported route: "${event.httpMethod} ${event.resource}"`);
        }
    } catch (err) {
        statusCode = 400;
        body = err.message;
    } finally {
        body = JSON.stringify(body);
    }

    return {
        statusCode,
        body,
        headers,
    };
*/
};
}

