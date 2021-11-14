import { ActionFunction, json } from "remix";
import { Discounts } from "~/schemas/discounts";



export let action: ActionFunction = async ({request}) => {
    let body = new URLSearchParams(await request.text())

    let discount = await Discounts.findOne({code: body.get('code')})
    if (!discount || (discount && discount.used)) {
        return json({percentage: null, used: false}) 
    }
    return json({...discount.toObject()})
}

export default function Index() {
    return null
}