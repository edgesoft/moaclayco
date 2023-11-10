import React from "react";
import { Order } from "~/types";

export enum Template {
  ORDER,
  SHIPPING,
}

export type TemplateType = {
  order: Order;
  template: Template;
};

const EmailOrderTemplate: React.FC<TemplateType> = ({ order, template }) => {
  const { _id, customer, items, freightCost, discount, totalSum } = order;

  const headerStyle = {
    backgroundImage:
      "url('https://moaclayco-prod.s3.eu-north-1.amazonaws.com/background3.jpg')",
    backgroundPosition: "center left",
    backgroundRepeat: "no-repeat",
    height: "80px", // Fixed height for larger screens
    borderBottom: "1px solid black",
    padding: "20px", // Default padding for larger screens
    color: "#4B5563",
    fontFamily: "'Noteworthy', Arial, sans-serif",
    fontSize: "40px",
  };

  const containerStyle = {
    width: "100%",
    maxWidth: "600px",
    margin: "20px auto",
    border: "1px solid #dddddd",
    borderRadius: "8px",
    overflow: "hidden",
    backgroundColor: "#ffffff",
  };

  const badgeStyle = {
    display: "inline-block",
    padding: "3px 8px",
    fontSize: "12px",
    backgroundColor: "#D1FAE5",
    color: "#065F46",
    borderRadius: "9999px",
    fontWeight: "bold",
  };

  const itemNameStyle = {
    display: "inline-block",
    verticalAlign: "middle",
    color: "#4B5563",
    maxWidth: "100%", // Ensures the span doesn't exceed the parent width
    overflow: "hidden",
    textOverflow: "ellipsis",
    WhiteSpace: "nowrap",
  };

  return (
    <html>
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=utf-8" />
        <title>Moa Clay Collection</title>
        <style type="text/css">
          {`
            @media screen and (max-width: 480px) {
              .headerStyle {
                font-size: 20px !important; /* Smaller font size for smaller screens */
                padding-top: 30px !important; /* Adjust padding to center the text vertically */
                padding-bottom: 30px !important; /* Adjust padding to center the text vertically */
                height: auto !important; /* Allow height to adjust to content */
              }
            
            }
          `}
        </style>
      </head>
      <body
        style={{
          backgroundColor: "#ffffff",
          margin: 0,
          padding: 0,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={headerStyle} className="headerStyle">
          &nbsp;
        </div>

        <div
          style={{
            fontFamily: "Arial, sans-serif",
            backgroundColor: "#ffffff",
            textAlign: "center",
            border: "1px solid #dddddd",
            width: "100%",
            maxWidth: "600px",
            margin: "20px auto",
            marginBottom: "5px",
          }}
        >
          <div style={{ textAlign: "left", padding: "4px" }}>
            <h2 style={{ color: "#4B5563", margin: 0 }}>
              Hej {customer.firstname} {customer.lastname}!
            </h2>
            <h4
              style={{
                color: "#4B5563",
                margin: 0,
                fontWeight: "normal",
              }}
              dangerouslySetInnerHTML={{
                __html:
                  template === Template.ORDER
                    ? `Tack för din order (<strong>${_id.toString()}</strong>)! Vi kommer
         att behandla ordern så snart vi kan.
         <br />
         Med vänliga hälsningar Moa Clay Collection`
                    : `Ditt paket är skickat och påväg till dig, jag hoppas du kommer älska dina nya smycken!<br/><br/>
         Ditt ordernummer är <strong>${_id.toString()}</strong> och all information du behöver hittar du här nedan.<br/><br>
         Ha en fantastisk dag!<br/>
         XOXO MoaClayCo`,
              }}
            />
          </div>
        </div>
        <div style={containerStyle}>
          <div style={{ padding: "20px", textAlign: "center" }}>
            <p style={{ fontSize: "24px", color: "#333333", margin: 0 }}>
              {template === Template.ORDER
                ? "Tack för din order!"
                : "Din order är påväg!"}
            </p>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <th
                  style={{
                    color: "#4B5563",
                    backgroundColor: "#E5E7EB",
                    padding: "8px",
                    textAlign: "left",
                  }}
                >
                  NAMN
                </th>
                <th
                  style={{
                    color: "#4B5563",
                    backgroundColor: "#E5E7EB",
                    padding: "8px",
                    textAlign: "left",
                  }}
                >
                  ANTAL
                </th>
                <th
                  style={{
                    color: "#4B5563",
                    backgroundColor: "#E5E7EB",
                    padding: "8px",
                    textAlign: "left",
                  }}
                >
                  ST PRIS
                </th>
              </tr>
              {items.map((item) => (
                <React.Fragment key={item._id}>
                  <tr style={{ borderTop: "1px solid #dddddd" }}>
                    <td
                      colSpan={3}
                      style={{ paddingTop: "10px", textAlign: "center" }}
                    >
                      <div
                        style={{
                          display: "inline-block",
                          verticalAlign: "middle",
                          textAlign: "center",
                          borderRadius: "50%",
                          overflow: "hidden",
                          width: "100px",
                          height: "100px",
                        }}
                      >
                        <img
                          src={item.image}
                          alt={item.name}
                          style={{
                            width: "100px",
                            height: "100px",
                            borderRadius: "50%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td style={{ textAlign: "left", padding: "8px" }}>
                      <span style={itemNameStyle}>{item.name}</span>
                    </td>
                    <td style={{ textAlign: "left", padding: "8px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 8px",
                          fontSize: "12px",
                          backgroundColor: "#D1FAE5",
                          color: "#065F46",
                          borderRadius: "9999px",
                          fontWeight: "bold",
                        }}
                      >
                        {item.quantity}
                      </span>
                    </td>
                    <td
                      style={{
                        color: "#4B5563",
                        textAlign: "left",
                        padding: "8px",
                      }}
                    >
                      {item.price} SEK
                    </td>
                  </tr>
                  {item.additionalItems
                    ? item.additionalItems.map((a) => {
                        return (
                          <tr key={item._id}>
                            <td style={{ textAlign: "left", padding: "8px" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  verticalAlign: "middle",
                                  color: "#4B5563",
                                  fontSize: 13,
                                }}
                              >
                                {a.name}
                              </span>
                            </td>
                            <td style={{ textAlign: "left", padding: "8px" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  fontSize: "12px",
                                  backgroundColor: "#D1FAE5",
                                  color: "#065F46",
                                  borderRadius: "9999px",
                                  fontWeight: "bold",
                                }}
                              >
                                1
                              </span>
                            </td>
                            <td
                              style={{
                                color: "#4B5563",
                                textAlign: "left",
                                padding: "8px",
                              }}
                            >
                              {a.price} SEK
                            </td>
                          </tr>
                        );
                      })
                    : null}
                </React.Fragment>
              ))}

              <tr>
                <td
                  style={{
                    borderTop: "1px solid #dddddd",
                    color: "#4B5563",
                    textAlign: "left",
                    padding: "8px",
                  }}
                >
                  Frakt
                </td>
                <td
                  style={{
                    borderTop: "1px solid #dddddd",
                    textAlign: "left",
                    padding: "8px",
                  }}
                >
                  <span style={badgeStyle}>1</span>
                </td>
                <td
                  style={{
                    borderTop: "1px solid #dddddd",
                    color: "#4B5563",
                    textAlign: "left",
                    padding: "8px",
                  }}
                >
                  {freightCost > 0 ? `${freightCost} SEK` : "Fri frakt"}
                </td>
              </tr>
              {discount && discount.amount ? (
                <tr>
                  <td
                    style={{
                      color: "#4B5563",
                      textAlign: "left",
                      padding: "8px",
                    }}
                  >
                    Rabatt
                  </td>
                  <td style={{ textAlign: "left", padding: "8px" }}>
                    <span style={badgeStyle}>1</span>
                  </td>
                  <td
                    style={{
                      color: "#4B5563",
                      textAlign: "left",
                      padding: "8px",
                    }}
                  >
                    -{discount.amount} SEK
                  </td>
                </tr>
              ) : null}

              <tr>
                <td
                  style={{
                    fontWeight: "bold",
                    color: "#4B5563",
                    textAlign: "left",
                    padding: "8px",
                  }}
                >
                  Totalt
                </td>
                <td style={{ textAlign: "left", padding: "8px" }}>&nbsp;</td>
                <td
                  style={{
                    fontWeight: "bold",
                    color: "#4B5563",
                    textAlign: "left",
                    padding: "8px",
                  }}
                >
                  {totalSum} SEK
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          style={{
            backgroundColor: "#f7f7f7",
            textAlign: "center",
            fontSize: "14px",
            color: "#6b7280",
            padding: "14px 0",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <div style={{ marginBottom: "4px" }}>© Moa Clay Co 2023</div>
        </div>
      </body>
    </html>
  );
};

export default EmailOrderTemplate;
